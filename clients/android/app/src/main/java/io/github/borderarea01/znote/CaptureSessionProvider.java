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
    @Override public synchronized Bundle call(String method,String arg,Bundle extras){
        if(Binder.getCallingUid()!=android.os.Process.myUid())throw new SecurityException("Private capture session");
        if(!"session".equals(method))throw new IllegalArgumentException("Unsupported operation");
        SharedPreferences prefs=getContext().getSharedPreferences("MainActivity",0);
        String origin=prefs.getString("origin","");Bundle result=new Bundle();result.putString("origin",origin);
        result.putString("cookie",origin.isEmpty()?"":CookieManager.getInstance().getCookie(origin));
        result.putString("token",captureToken(origin,result.getString("cookie","")));
        result.putString("share_collection",prefs.getString("share_collection",""));result.putBoolean("capture_as_note",prefs.getBoolean("capture_as_note",false));return result;
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
            connection=(java.net.HttpURLConnection)new java.net.URL(origin+"/api/tokens").openConnection();
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
