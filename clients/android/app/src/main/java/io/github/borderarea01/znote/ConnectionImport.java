package io.github.borderarea01.znote;

import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** A user-confirmed connection invitation. Never follows redirects or stores the code. */
final class ConnectionImport {
    final String origin,code;
    private String sessionCookie;
    private ConnectionImport(String origin,String code){this.origin=origin;this.code=code;}
    static ConnectionImport parse(String value)throws Exception {
        if(value==null||value.length()>4096)throw new Exception("导入链接无效");
        URI uri=new URI(value.trim());String server,code;
        if("znote".equals(uri.getScheme())&&"connect".equals(uri.getHost())&&(uri.getPath()==null||uri.getPath().isEmpty())){
            server=parameter(uri.getRawQuery(),"server");code=parameter(uri.getRawQuery(),"code");
        }else if(("https".equals(uri.getScheme())||"http".equals(uri.getScheme()))&&"/connect".equals(uri.getPath())&&uri.getRawQuery()==null&&uri.getRawUserInfo()==null){
            server=uri.getScheme()+"://"+uri.getRawAuthority();code=parameter(uri.getRawFragment(),"code");
        }else throw new Exception("请粘贴完整的 ZNote 连接邀请链接");
        if(server==null||server.isEmpty())throw new Exception("连接邀请缺少服务器地址");server=MainActivity.normalize(server);
        if(code==null||!code.matches("[a-zA-Z0-9_-]{16,80}"))throw new Exception("连接邀请缺少有效授权码，请重新生成");
        return new ConnectionImport(server,code);
    }
    private static String parameter(String query,String key)throws Exception {
        String result=null;if(query!=null)for(String part:query.split("&")){String[] pair=part.split("=",2);if(URLDecoder.decode(pair[0],"UTF-8").equals(key)){if(result!=null)throw new Exception("导入链接参数重复");result=URLDecoder.decode(pair.length==2?pair[1]:"","UTF-8");}}
        return result;
    }
    static final class Authorization {final String cookie,token;Authorization(String cookie,String token){this.cookie=cookie;this.token=token;}}
    private JSONObject request(String path,JSONObject input,String cookie,String[] received)throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL(origin+path).openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(8000);
        try{
            if(cookie!=null)connection.setRequestProperty("Cookie",cookie);
            if(input!=null){connection.setRequestMethod("POST");connection.setRequestProperty("Content-Type","application/json");connection.setDoOutput(true);try(OutputStream out=connection.getOutputStream()){out.write(input.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=connection.getResponseCode();if(status>=300&&status<400)throw new IOException("连接入口发生跳转，请重新生成邀请");
            InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(stream!=null)try(InputStream in=stream){byte[] block=new byte[1024];int n;while((n=in.read(block))!=-1){if(bytes.size()+n>16384)throw new IOException("连接入口响应异常");bytes.write(block,0,n);}}
            JSONObject data=new JSONObject(bytes.toString("UTF-8"));if(status<200||status>=300)throw new IOException(data.optString("error","连接失败，请稍后重试"));
            if(received!=null){String header=connection.getHeaderField("Set-Cookie");if(header==null||!header.startsWith("znote_session="))throw new IOException("连接入口未返回授权");received[0]=header;}
            return data;
        }finally{connection.disconnect();}
    }
    Authorization authorize()throws Exception {
        JSONObject health=request("/api/health",null,null,null);
        if(!"ok".equals(health.optString("status"))||!"remote-capture".equals(health.optString("mode")))throw new IOException("此邀请不是 ZNote 远程采集入口");
        if(sessionCookie==null){String[] cookie={null};request("/api/auth/login",new JSONObject().put("password",code),null,cookie);sessionCookie=cookie[0];}
        JSONObject device=request("/api/tokens",new JSONObject().put("name","Android 手机采集 · "+android.os.Build.MODEL).put("scope","write"),sessionCookie.split(";",2)[0],null);
        String token=device.optString("token");if(!token.matches("zn_[0-9a-f]{64}"))throw new IOException("设备授权无效，请重新生成邀请");
        return new Authorization(sessionCookie,token);
    }
}
