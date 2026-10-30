package io.github.borderarea01.znote;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.webkit.CookieManager;

/** Main process owns WebView login; only our capture process may read a snapshot.
 * Callers use a worker: a cold WebView provider must never block overlay input. */
public class CaptureSessionProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    @Override public Bundle call(String method,String arg,Bundle extras){
        if(Binder.getCallingUid()!=android.os.Process.myUid())throw new SecurityException("Private capture session");
        if("appearance".equals(method))return NativeAppearance.save(getContext(),arg);
        if("pixiv".equals(method))return PixivSession.resolve(arg);
        if(!"session".equals(method))throw new IllegalArgumentException("Unsupported operation");
        return session(arg,extras);
    }
    private synchronized Bundle session(String arg,Bundle extras){
        SharedPreferences prefs=getContext().getSharedPreferences("MainActivity",0);
        String preferred=prefs.getString("origin",""),remote=prefs.getString("remote_capture_origin",""),lan=prefs.getString("lan_origin","");
        if(!preferred.isEmpty()&&!prefs.contains("routing_legacy_origin"))prefs.edit().putString("routing_legacy_origin",preferred).commit();
        if(lan.isEmpty()&&ConnectionRoutes.local(preferred)&&!preferred.equals(remote))lan=preferred;
        if(lan.isEmpty()){String previous=prefs.getString("previous_origin","");if(ConnectionRoutes.local(previous)&&!previous.equals(remote))lan=previous;}
        final String selectedLan=lan;
        String origin=arg!=null&&!arg.isEmpty()?arg:extras!=null&&extras.getBoolean("legacy_job",false)?prefs.getString("routing_legacy_origin",preferred):ConnectionRoutes.choose(preferred,lan,remote,extras!=null&&extras.getBoolean("local_only",false),this::localAvailable);
        try{if(!origin.isEmpty())origin=MainActivity.normalize(origin);}catch(Exception e){origin="";}
        Bundle result=new Bundle();result.putString("origin",origin);result.putString("route",origin.equals(selectedLan)?"lan":origin.equals(remote)&&!remote.isEmpty()?"remote":"configured");
        result.putString("cookie",origin.isEmpty()?"":CookieManager.getInstance().getCookie(origin));
        result.putString("token",captureToken(origin,result.getString("cookie","")));
        result.putString("share_collection",prefs.getString("share_collection",""));result.putBoolean("capture_as_note",prefs.getBoolean("capture_as_note",false));return result;
    }
    private boolean localAvailable(String origin){
        if(!ConnectionRoutes.local(origin))return false;
        java.net.HttpURLConnection c=null;
        try{
            // A real server response, not Wi-Fi/Internet validation, determines
            // LAN reachability. Never send a remote token to a local address.
            c=(java.net.HttpURLConnection)new java.net.URL(origin+"/api/health").openConnection(java.net.Proxy.NO_PROXY);
            c.setInstanceFollowRedirects(false);c.setConnectTimeout(500);c.setReadTimeout(700);
            if(c.getResponseCode()!=200)return false;
            String health=small(c);org.json.JSONObject info=new org.json.JSONObject(health);
            if(!"ok".equals(info.optString("status"))||info.optString("version").isEmpty()||"remote-capture".equals(info.optString("mode")))return false;
            c.disconnect();c=null;
            String cookie=CookieManager.getInstance().getCookie(origin),token=captureToken(origin,cookie);
            if(token.isEmpty()&&(cookie==null||cookie.isEmpty()))return false;
            c=(java.net.HttpURLConnection)new java.net.URL(origin+"/api/me").openConnection(java.net.Proxy.NO_PROXY);c.setInstanceFollowRedirects(false);c.setConnectTimeout(500);c.setReadTimeout(700);
            if(!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);else c.setRequestProperty("Cookie",cookie);
            if(c.getResponseCode()!=200)return false;
            String scope=new org.json.JSONObject(small(c)).optString("scope");return "write".equals(scope)||"admin".equals(scope);
        }catch(Exception ignored){return false;}finally{if(c!=null)c.disconnect();}
    }
    private String small(java.net.HttpURLConnection c)throws java.io.IOException{
        try(java.io.InputStream in=c.getInputStream();java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){byte[] bytes=new byte[512];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>4096)throw new java.io.IOException("Invalid connection response");out.write(bytes,0,n);}return out.toString("UTF-8");}
    }
    private String fingerprint(String cookie){
        try{return android.util.Base64.encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(cookie.getBytes(java.nio.charset.StandardCharsets.UTF_8)),android.util.Base64.NO_WRAP);}catch(Exception e){throw new IllegalStateException(e);}
    }
    private String captureToken(String origin,String cookie){
        if(origin.isEmpty())return "";
        // Each server has its own credential. Never persist the access password.
        SharedPreferences auth=getContext().getSharedPreferences("CaptureAuthorization",0);
        String key=Uri.encode(origin),cached=auth.getString(key,"");
        if(!cached.isEmpty()){
            // Explicitly logging in again permits repairing a revoked device credential.
            // Cookie expiration alone never discards a working capture credential.
            String paired=auth.getString(key+".session","");
            if(cookie==null||cookie.isEmpty()||fingerprint(cookie).equals(paired))return cached;
        }
        if(cookie==null||cookie.isEmpty())return "";
        java.net.HttpURLConnection connection=null;
        try{
            connection=(java.net.HttpURLConnection)(ConnectionRoutes.local(origin)?new java.net.URL(origin+"/api/tokens").openConnection(java.net.Proxy.NO_PROXY):new java.net.URL(origin+"/api/tokens").openConnection());
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(6000);connection.setReadTimeout(6000);
            connection.setRequestMethod("POST");connection.setRequestProperty("Cookie",cookie);connection.setRequestProperty("Content-Type","application/json");connection.setDoOutput(true);
            byte[] body=new org.json.JSONObject().put("name","Android 手机采集 · "+Build.MODEL).put("scope","write").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            try(java.io.OutputStream out=connection.getOutputStream()){out.write(body);}
            if(connection.getResponseCode()!=201)return cached;
            java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
            try(java.io.InputStream in=connection.getInputStream()){byte[] block=new byte[1024];int n;while((n=in.read(block))!=-1){if(bytes.size()+n>8192)return "";bytes.write(block,0,n);}}
            String token=new org.json.JSONObject(bytes.toString("UTF-8")).getString("token");
            if(!token.matches("zn_[0-9a-f]{64}"))return "";
            if(!auth.edit().putString(key,token).putString(key+".session",fingerprint(cookie)).commit())return cached;
            return token;
        }catch(Exception ignored){return cached;}finally{if(connection!=null)connection.disconnect();}
    }
    @Override public Cursor query(Uri u,String[] p,String s,String[] a,String o){throw new UnsupportedOperationException();}
    @Override public String getType(Uri u){return null;}
    @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    @Override public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    @Override public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
