package io.github.borderarea01.znote;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.*;

/** Runs on a worker in the WebView-owning main process. The Pixiv cookie
 * stays here; capture queues receive only the selected artwork's metadata. */
final class PixivSession {
    static String work(String value){
        try{Uri u=Uri.parse(value);String host=u.getHost();if(!"https".equals(u.getScheme())||!("www.pixiv.net".equals(host)||"pixiv.net".equals(host))||u.getUserInfo()!=null||u.getPort()!=-1)return "";java.util.regex.Matcher m=java.util.regex.Pattern.compile("^/(?:[a-z]{2}/)?artworks/(\\d{1,12})/?$").matcher(u.getPath());return m.matches()?m.group(1):"";}catch(Exception e){return "";}
    }
    static boolean loggedIn(){String cookie=CookieManager.getInstance().getCookie("https://www.pixiv.net/");return cookie!=null&&java.util.regex.Pattern.compile("(?:^|;\\s*)PHPSESSID=[^;]+").matcher(cookie).find();}
    static Bundle resolve(String value){
        Bundle result=new Bundle();
        try{
            String id=work(value);if(id.isEmpty())throw new Exception("请提供 Pixiv 单个作品链接");
            JSONObject info=get("/ajax/illust/"+id,id);JSONArray pages=get("/ajax/illust/"+id+"/pages",id).getJSONArray("body");JSONObject body=info.getJSONObject("body");
            if(!id.equals(body.optString("id")))throw new Exception("Pixiv 作品编号不匹配");
            if(body.optInt("illustType")==2)throw new Exception("Pixiv 动图请使用电脑 Pixiv 采集扩展，未将封面冒充动画");
            if(pages.length()<1||pages.length()>200||body.optInt("pageCount")!=pages.length())throw new Exception("Pixiv 未返回完整图集（最多 200 张）");
            JSONArray images=new JSONArray(),tags=new JSONArray();
            for(int i=0;i<pages.length();i++){JSONObject urls=pages.getJSONObject(i).getJSONObject("urls");images.put(new JSONObject().put("original",urls.getString("original")).put("preview",urls.optString("regular",urls.optString("small",urls.getString("original")))));}
            JSONArray sourceTags=body.optJSONObject("tags")==null?null:body.optJSONObject("tags").optJSONArray("tags");if(sourceTags!=null)for(int i=0;i<Math.min(25,sourceTags.length());i++)tags.put(sourceTags.getJSONObject(i).optString("tag"));
            String description=android.text.Html.fromHtml(body.optString("description"),android.text.Html.FROM_HTML_MODE_LEGACY).toString().trim();
            JSONObject post=new JSONObject().put("work_id",id).put("page_count",pages.length()).put("type",body.optInt("illustType")).put("title",body.optString("title")).put("author",body.optString("userName")).put("description",description.length()>16000?description.substring(0,16000):description).put("images",images).put("tags",tags);
            if(post.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>240000)throw new Exception("作品数据过大，请缩小采集范围");
            result.putString("post",post.toString());
        }catch(Exception e){result.putString("error",e.getMessage()==null?"Pixiv 读取失败":e.getMessage());result.putBoolean("requires_login",e instanceof LoginRequired);}
        return result;
    }
    private static final class LoginRequired extends Exception{LoginRequired(){super("请先在 ZNote 内登录 Pixiv；若已登录，请检查作品访问权限");}}
    private static JSONObject get(String path,String id)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL("https://www.pixiv.net"+path).openConnection();
        try{
            c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setRequestProperty("Accept","application/json");c.setRequestProperty("Referer","https://www.pixiv.net/artworks/"+id);c.setRequestProperty("User-Agent","Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36");
            String cookie=CookieManager.getInstance().getCookie("https://www.pixiv.net/");if(cookie!=null&&!cookie.isEmpty())c.setRequestProperty("Cookie",cookie);
            int status=c.getResponseCode();if(status==401||status==403||status==404||status/100==3)throw new LoginRequired();if(status!=200)throw new Exception("Pixiv 读取失败 HTTP "+status);
            java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();try(java.io.InputStream in=c.getInputStream()){byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>2097152)throw new Exception("Pixiv 作品响应过大");out.write(bytes,0,n);}}
            JSONObject data=new JSONObject(out.toString("UTF-8"));if(data.optBoolean("error"))throw new LoginRequired();return data;
        }finally{c.disconnect();}
    }
}
