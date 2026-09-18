package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Environment;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** GitHub is the catalog; Android owns background downloads and installation. */
final class AppUpdates {
    static final String REPOSITORY="https://github.com/BorderArea01/ZNote/";
    static final String CATALOG="https://api.github.com/repos/BorderArea01/ZNote/releases?per_page=30";
    static final long MAX_APK=100*1024*1024;
    static SharedPreferences prefs(Context c){return c.getSharedPreferences("AppUpdates",Context.MODE_PRIVATE);}
    static String installedVersion(Context c){try{return c.getPackageManager().getPackageInfo(c.getPackageName(),0).versionName;}catch(Exception e){return "0.0.0";}}
    static final class Release {
        final String version,url,hash,notes;
        final long size;
        Release(String version,String url,String hash,long size,String notes){this.version=version;this.url=url;this.hash=hash;this.size=size;this.notes=notes;}
        JSONObject json()throws JSONException{return new JSONObject().put("version",version).put("url",url).put("hash",hash).put("size",size).put("notes",notes);}
        static Release read(JSONObject j)throws JSONException{return new Release(j.getString("version"),j.getString("url"),j.getString("hash"),j.getLong("size"),j.optString("notes"));}
    }
    static int compare(String a,String b){
        int[] x=parts(a),y=parts(b);for(int i=0;i<x.length;i++)if(x[i]!=y[i])return Integer.compare(x[i],y[i]);return 0;
    }
    private static int[] parts(String version){
        java.util.regex.Matcher m=java.util.regex.Pattern.compile("^(\\d+)\\.(\\d+)\\.(\\d+)(?:-beta\\.(\\d+))?$").matcher(version);
        if(!m.matches())throw new IllegalArgumentException("不支持的版本号");
        return new int[]{Integer.parseInt(m.group(1)),Integer.parseInt(m.group(2)),Integer.parseInt(m.group(3)),m.group(4)==null?Integer.MAX_VALUE:Integer.parseInt(m.group(4))};
    }
    static Release latest(JSONArray releases,String current)throws JSONException{
        Release best=null;
        for(int i=0;i<releases.length();i++){
            JSONObject r=releases.getJSONObject(i);if(r.optBoolean("draft"))continue;
            JSONArray assets=r.optJSONArray("assets");if(assets==null)continue;
            for(int n=0;n<assets.length();n++){
                JSONObject a=assets.getJSONObject(n);java.util.regex.Matcher name=java.util.regex.Pattern.compile("^ZNote-(\\d+\\.\\d+\\.\\d+(?:-beta\\.\\d+)?)-android\\.apk$").matcher(a.optString("name"));
                if(!name.matches())continue;String version=name.group(1),digest=a.optString("digest"),url=a.optString("browser_download_url");long size=a.optLong("size");
                if(!url.startsWith(REPOSITORY+"releases/download/")||!url.endsWith("/"+a.optString("name"))||!digest.matches("sha256:[a-f0-9]{64}")||size<=0||size>MAX_APK)continue;
                try{if(compare(version,current)>0&&(best==null||compare(version,best.version)>0))best=new Release(version,url,digest.substring(7),size,r.optString("body"));}catch(IllegalArgumentException ignored){}
            }
        }return best;
    }
    static Release check(Context c)throws Exception{
        HttpURLConnection connection=(HttpURLConnection)new URL(CATALOG).openConnection();connection.setConnectTimeout(12000);connection.setReadTimeout(12000);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("Accept","application/vnd.github+json");connection.setRequestProperty("User-Agent","ZNote-Android");
        try{
            int code=connection.getResponseCode();if(code!=200)throw new IOException(code==403||code==429?"更新服务器暂时限流，请稍后重试":"检查更新失败（HTTP "+code+"）");
            ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=connection.getInputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>2*1024*1024)throw new IOException("更新信息过大");out.write(b,0,n);}}
            Release release=latest(new JSONArray(out.toString("UTF-8")),installedVersion(c));prefs(c).edit().putLong("checked_at",System.currentTimeMillis()).apply();return release;
        }finally{connection.disconnect();}
    }
    static void backgroundCheck(Activity activity){
        SharedPreferences p=prefs(activity);if(!p.getBoolean("auto_check",true)||System.currentTimeMillis()-p.getLong("checked_at",0)<24*60*60*1000L)return;
        p.edit().putLong("checked_at",System.currentTimeMillis()).apply();
        new Thread(()->{try{Release release=check(activity);if(release==null||release.version.equals(p.getString("notified","")))return;activity.runOnUiThread(()->{if(activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())return;p.edit().putString("notified",release.version).apply();new AlertDialog.Builder(activity).setTitle("ZNote 有新版本 "+release.version).setMessage("可在 App 内下载并覆盖更新。").setNegativeButton("稍后",null).setPositiveButton("查看更新",(d,w)->activity.startActivity(new Intent(activity,UpdateActivity.class))).show();});}catch(Exception ignored){}},"znote-update-check").start();
    }
    static long download(Context c,Release release)throws Exception{
        if(!release.url.startsWith(REPOSITORY+"releases/download/"))throw new IOException("更新来源不正确");
        DownloadManager manager=(DownloadManager)c.getSystemService(Context.DOWNLOAD_SERVICE);clear(c);
        String name="znote-update-"+release.version+".apk";
        File old=new File(c.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),name);if(old.exists()&&!old.delete())throw new IOException("无法清理旧安装包");
        DownloadManager.Request request=new DownloadManager.Request(Uri.parse(release.url)).setTitle("ZNote "+release.version+" 更新").setMimeType("application/vnd.android.package-archive").setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE).setDestinationInExternalFilesDir(c,Environment.DIRECTORY_DOWNLOADS,name);
        long id=manager.enqueue(request);prefs(c).edit().putLong("download_id",id).putString("release",release.json().toString()).apply();return id;
    }
    static void clear(Context c){long id=prefs(c).getLong("download_id",0);if(id!=0)((DownloadManager)c.getSystemService(Context.DOWNLOAD_SERVICE)).remove(id);prefs(c).edit().remove("download_id").remove("release").apply();}
    static IOException archiveVersionError(String expectedPackage,String archivePackage,String expectedVersion,String archiveVersion,long archiveCode,String installedVersion,long installedCode){
        if(!expectedPackage.equals(archivePackage))return new IOException("下载的安装包包名不匹配，已停止安装");
        if(!expectedVersion.equals(archiveVersion))return new IOException("安装包版本与更新信息不匹配（更新信息 "+expectedVersion+"，安装包 "+archiveVersion+"）");
        if(archiveCode<=installedCode)return new IOException("下载包序号不高：当前已安装 "+installedVersion+"（"+installedCode+"），下载包 "+archiveVersion+"（"+archiveCode+"）");
        return null;
    }
    static void verify(Context c,File file,Release release)throws Exception{
        if(!file.isFile()||file.length()!=release.size||file.length()>MAX_APK)throw new IOException("安装包不完整，请重新下载");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}
        StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",b&255));
        if(!release.hash.equals(hash.toString()))throw new IOException("安装包校验失败，请重新下载");
        PackageManager pm=c.getPackageManager();PackageInfo archive=pm.getPackageArchiveInfo(file.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES),installed=pm.getPackageInfo(c.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        if(archive==null)throw new IOException("安装包签名或版本清单无法识别，已停止安装；请重新下载更新");
        IOException versionError=archiveVersionError(c.getPackageName(),archive.packageName,release.version,archive.versionName,archive.getLongVersionCode(),installed.versionName,installed.getLongVersionCode());
        if(versionError!=null)throw versionError;
        if(archive.signingInfo==null||installed.signingInfo==null||!new HashSet<>(Arrays.asList(archive.signingInfo.getApkContentsSigners())).equals(new HashSet<>(Arrays.asList(installed.signingInfo.getApkContentsSigners()))))throw new IOException("安装包签名不匹配，已停止安装");
    }
}
