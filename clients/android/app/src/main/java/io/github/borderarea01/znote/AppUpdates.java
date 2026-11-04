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

/** Public Pages catalog and APK share a route; GitHub is an independent fallback. */
final class AppUpdates {
    static final String REPOSITORY="https://github.com/b0rderl4nder/ZNote/";
    static final String CATALOG="https://api.github.com/repos/b0rderl4nder/ZNote/releases?per_page=30";
    static final String PAGES="https://znote-capture-inbox.pages.dev";
    static final String MANIFEST=PAGES+"/downloads/latest.json";
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
            JSONObject r=releases.getJSONObject(i);if(r.optBoolean("draft")||!current.contains("-beta.")&&r.optBoolean("prerelease"))continue;
            JSONArray assets=r.optJSONArray("assets");if(assets==null)continue;
            for(int n=0;n<assets.length();n++){
                JSONObject a=assets.getJSONObject(n);java.util.regex.Matcher name=java.util.regex.Pattern.compile("^ZNote-(\\d+\\.\\d+\\.\\d+(?:-beta\\.\\d+)?)-android\\.apk$").matcher(a.optString("name"));
                if(!name.matches())continue;String version=name.group(1),digest=a.optString("digest"),url=a.optString("browser_download_url");long size=a.optLong("size");
                if(!url.startsWith(REPOSITORY+"releases/download/")||!url.endsWith("/"+a.optString("name"))||!digest.matches("sha256:[a-f0-9]{64}")||size<=0||size>MAX_APK)continue;
                try{if(compare(version,current)>0&&(best==null||compare(version,best.version)>0))best=new Release(version,url,digest.substring(7),size,r.optString("body"));}catch(IllegalArgumentException ignored){}
            }
        }return best;
    }
    static String pagesUrl(String version){parts(version);return PAGES+"/downloads/ZNote-"+version+"-android.apk";}
    static String githubUrl(String version){parts(version);return REPOSITORY+"releases/download/"+(version.contains("-beta.")?"android-v":"v")+version+"/ZNote-"+version+"-android.apk";}
    static boolean trusted(Release r){return r!=null&&r.hash.matches("[a-f0-9]{64}")&&r.size>0&&r.size<=MAX_APK&&(r.url.equals(pagesUrl(r.version))||r.url.startsWith(REPOSITORY+"releases/download/")&&r.url.endsWith("/ZNote-"+r.version+"-android.apk")&&!r.url.contains("?")&&!r.url.contains("#"));}
    static Release pagesRelease(JSONObject data,String current)throws Exception{
        String version=data.getString("version");String expected="/downloads/ZNote-"+version+"-android.apk";parts(version);
        if(!expected.equals(data.getString("apk")))throw new IOException("更新目录的安装包地址无效");
        Release r=new Release(version,PAGES+expected,data.getString("apk_sha256"),data.getLong("apk_size"),data.optString("notes"));
        if(!trusted(r))throw new IOException("更新目录的安装包校验信息无效");return compare(version,current)>0?r:null;
    }
    interface CatalogReader{String read(String url)throws Exception;}
    static Release checkCatalog(String current,CatalogReader reader)throws Exception{
        Exception primary;
        try{return pagesRelease(new JSONObject(reader.read(MANIFEST)),current);}catch(Exception e){primary=e;}
        try{return latest(new JSONArray(reader.read(CATALOG)),current);}catch(Exception e){IOException failure=new IOException("更新目录与备用目录均无法连接，请稍后重试（主入口："+reason(primary)+"；备用："+reason(e)+"）");failure.addSuppressed(primary);failure.addSuppressed(e);throw failure;}
    }
    static String reason(Exception e){if(e instanceof SocketTimeoutException)return "连接超时";if(e instanceof UnknownHostException)return "域名解析失败";if(e instanceof javax.net.ssl.SSLException)return "安全连接失败";if(e instanceof JSONException||e instanceof IllegalArgumentException)return "目录格式错误";return e.getMessage()!=null&&e.getMessage().startsWith("HTTP ")?e.getMessage():"网络或目录暂不可用";}
    static String readCatalog(String url)throws Exception{return readCatalog(url,null);}
    static String readCatalog(String url,Proxy transport)throws Exception{
        HttpURLConnection connection=(HttpURLConnection)(transport==null?new URL(url).openConnection():new URL(url).openConnection(transport));connection.setConnectTimeout(5000);connection.setReadTimeout(5000);connection.setUseCaches(false);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("Accept",url.equals(CATALOG)?"application/vnd.github+json":"application/json");connection.setRequestProperty("User-Agent","ZNote-Android");
        try{
            int code=connection.getResponseCode();if(code!=200)throw new IOException("HTTP "+code);
            ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=connection.getInputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>2*1024*1024)throw new IOException("更新信息过大");out.write(b,0,n);}}
            return out.toString("UTF-8");
        }finally{connection.disconnect();}
    }
    static Release check(Context c)throws Exception{Release release=checkCatalog(installedVersion(c),AppUpdates::readCatalog);prefs(c).edit().putLong("checked_at",System.currentTimeMillis()).apply();return release;}
    static void backgroundCheck(Activity activity){
        SharedPreferences p=prefs(activity);if(!p.getBoolean("auto_check",true)||System.currentTimeMillis()-p.getLong("checked_at",0)<24*60*60*1000L)return;
        p.edit().putLong("checked_at",System.currentTimeMillis()).apply();
        new Thread(()->{try{Release release=check(activity);if(release==null||release.version.equals(p.getString("notified","")))return;activity.runOnUiThread(()->{if(activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())return;p.edit().putString("notified",release.version).apply();new AlertDialog.Builder(activity).setTitle("ZNote 有新版本 "+release.version).setMessage("可在 App 内下载并覆盖更新。").setNegativeButton("稍后",null).setPositiveButton("查看更新",(d,w)->activity.startActivity(new Intent(activity,UpdateActivity.class))).show();});}catch(Exception ignored){}},"znote-update-check").start();
    }
    static long download(Context c,Release release)throws Exception{
        if(!trusted(release))throw new IOException("更新来源或校验信息不正确");clear(c);return enqueue(c,release,release.url,0);
    }
    private static long enqueue(Context c,Release release,String url,int attempt)throws Exception{
        DownloadManager manager=(DownloadManager)c.getSystemService(Context.DOWNLOAD_SERVICE);
        String name="znote-update-"+release.version+(attempt==0?"":"-fallback")+".apk";
        File old=new File(c.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),name);if(old.exists()&&!old.delete())throw new IOException("无法清理旧安装包");
        DownloadManager.Request request=new DownloadManager.Request(Uri.parse(url)).setTitle("ZNote "+release.version+" 更新").setMimeType("application/vnd.android.package-archive").setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE).setDestinationInExternalFilesDir(c,Environment.DIRECTORY_DOWNLOADS,name);
        long id=manager.enqueue(request);prefs(c).edit().putLong("download_id",id).putString("release",release.json().toString()).putString("download_name",name).putInt("download_attempt",attempt).putLong("progress_bytes",-1).putLong("progress_at",System.currentTimeMillis()).apply();return id;
    }
    static synchronized boolean alternate(Context c,long expected,Release release)throws Exception{
        SharedPreferences p=prefs(c);if(expected==0||p.getLong("download_id",0)!=expected||p.getInt("download_attempt",0)!=0||!trusted(release))return false;
        String url=release.url.equals(pagesUrl(release.version))?githubUrl(release.version):pagesUrl(release.version);
        ((DownloadManager)c.getSystemService(Context.DOWNLOAD_SERVICE)).remove(expected);p.edit().remove("download_id").putInt("download_attempt",1).apply();enqueue(c,release,url,1);return true;
    }
    static boolean stalled(Context c,int state,int reason,long bytes,long now){
        SharedPreferences p=prefs(c);long previous=p.getLong("progress_bytes",-1),at=p.getLong("progress_at",now);
        if(bytes!=previous||now<at){p.edit().putLong("progress_bytes",bytes).putLong("progress_at",now).apply();return false;}
        boolean waiting=state==DownloadManager.STATUS_RUNNING||state==DownloadManager.STATUS_PAUSED&&reason==DownloadManager.PAUSED_WAITING_TO_RETRY;
        if(!waiting){p.edit().putLong("progress_at",now).apply();return false;}return now-at>=20000;
    }
    static File downloadedFile(Context c,Release r){return new File(c.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),prefs(c).getString("download_name","znote-update-"+r.version+".apk"));}
    static void clear(Context c){long id=prefs(c).getLong("download_id",0);if(id!=0)((DownloadManager)c.getSystemService(Context.DOWNLOAD_SERVICE)).remove(id);prefs(c).edit().remove("download_id").remove("release").remove("download_name").remove("download_attempt").remove("progress_bytes").remove("progress_at").apply();}
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
