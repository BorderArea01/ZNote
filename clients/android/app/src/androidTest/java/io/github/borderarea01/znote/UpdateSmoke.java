package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;

final class UpdateSmoke {
    private final Instrumentation test;
    UpdateSmoke(Instrumentation test){this.test=test;}
    private Context context(){return test.getTargetContext();}
    private UiAutomation automation(){return test.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);}
    private void report(String s){Bundle b=new Bundle();b.putString("stream","\n"+s+"\n");test.sendStatus(0,b);}
    private void shell(String command)throws Exception{try(ParcelFileDescriptor fd=automation().executeShellCommand(command);InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)){in.readAllBytes();}}
    private void tap(String text)throws Exception{
        long end=SystemClock.uptimeMillis()+10000;
        while(SystemClock.uptimeMillis()<end){android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();if(root!=null){for(android.view.accessibility.AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByText(text))if(text.equalsIgnoreCase(String.valueOf(n.getText()))&&n.isVisibleToUser()){if(n.refresh()&&n.isEnabled()&&n.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)){Thread.sleep(500);return;}}}Thread.sleep(150);}throw new Exception("Missing update control: "+text);
    }
    private void awaitText(String text)throws Exception{long end=SystemClock.uptimeMillis()+15000;while(SystemClock.uptimeMillis()<end){android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();if(root!=null)for(android.view.accessibility.AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByText(text))if(text.equalsIgnoreCase(String.valueOf(n.getText()))&&n.isVisibleToUser()&&n.isEnabled())return;Thread.sleep(150);}throw new Exception("Missing stable update screen: "+text);}
    static void catalog()throws Exception{
        if(!AppUpdates.githubUrl("0.10.0").contains("/releases/download/v0.10.0/"))throw new Exception("Stable download must use its actual release tag");
        if(AppUpdates.archiveVersionError("io.github.borderarea01.znote","io.github.borderarea01.znote","0.10.0","0.10.0",10034,"0.10.0-beta.33",10033)!=null)throw new Exception("Stable release must upgrade beta.33");
        JSONObject trialAsset=new JSONObject().put("name","ZNote-0.11.0-beta.1-android.apk").put("browser_download_url",AppUpdates.githubUrl("0.11.0-beta.1")).put("digest","sha256:"+"a".repeat(64)).put("size",123);
        JSONArray trial=new JSONArray().put(new JSONObject().put("prerelease",true).put("assets",new JSONArray().put(trialAsset)));
        if(AppUpdates.latest(trial,"0.10.0")!=null)throw new Exception("Stable user must not be moved into beta");
        if(AppUpdates.latest(trial,"0.10.0-beta.33")==null)throw new Exception("Explicit beta channel lost its update");
        if(AppUpdates.compare("0.10.0-beta.10","0.10.0-beta.9")<=0||AppUpdates.compare("0.10.0-beta.17","0.10.0-beta.16")<=0||AppUpdates.compare("0.10.0-beta.19","0.10.0-beta.18")<=0||AppUpdates.compare("0.10.0","0.10.0-beta.99")<=0)throw new Exception("Version order failed");
        if(AppUpdates.archiveVersionError("io.github.borderarea01.znote","io.github.borderarea01.znote","0.10.0-beta.19","0.10.0-beta.19",10019,"0.10.0-beta.18",10018)!=null)throw new Exception("New Android package should upgrade beta.18");
        IOException lower=AppUpdates.archiveVersionError("io.github.borderarea01.znote","io.github.borderarea01.znote","0.10.0-beta.19","0.10.0-beta.19",10018,"0.10.0-beta.18",10018);
        if(lower==null||!lower.getMessage().contains("10018")||!lower.getMessage().contains("beta.19"))throw new Exception("Version-code failure should explain installed and downloaded versions");
        IOException wrongPackage=AppUpdates.archiveVersionError("io.github.borderarea01.znote","example.other","0.10.0-beta.19","0.10.0-beta.19",10019,"0.10.0-beta.18",10018);
        if(wrongPackage==null||!wrongPackage.getMessage().contains("包名"))throw new Exception("Package mismatch should have a distinct error");
        IOException wrongName=AppUpdates.archiveVersionError("io.github.borderarea01.znote","io.github.borderarea01.znote","0.10.0-beta.19","0.10.0-beta.18",10019,"0.10.0-beta.18",10018);
        if(wrongName==null||!wrongName.getMessage().contains("版本与更新信息不匹配"))throw new Exception("Version-name mismatch should have a distinct error");
        JSONObject asset=new JSONObject().put("name","ZNote-0.10.0-beta.11-android.apk").put("browser_download_url",AppUpdates.REPOSITORY+"releases/download/android-v0.10.0-beta.11/ZNote-0.10.0-beta.11-android.apk").put("digest","sha256:"+"a".repeat(64)).put("size",123);
        JSONObject r=new JSONObject().put("draft",false).put("prerelease",true).put("assets",new JSONArray().put(asset));
        if(AppUpdates.latest(new JSONArray().put(r),"0.10.0-beta.10")==null)throw new Exception("Beta release missing");
        r.put("draft",true);if(AppUpdates.latest(new JSONArray().put(r),"0.10.0-beta.10")!=null)throw new Exception("Draft accepted");r.put("draft",false);asset.put("browser_download_url","https://example.com/update.apk");if(AppUpdates.latest(new JSONArray().put(r),"0.10.0-beta.10")!=null)throw new Exception("Foreign update source accepted");
        JSONObject pages=new JSONObject().put("version","0.10.0-beta.32").put("apk","/downloads/ZNote-0.10.0-beta.32-android.apk").put("apk_sha256","b".repeat(64)).put("apk_size",123);
        AppUpdates.Release primary=AppUpdates.pagesRelease(pages,"0.10.0-beta.31");if(primary==null||!primary.url.equals(AppUpdates.pagesUrl("0.10.0-beta.32")))throw new Exception("Pages catalog missing");
        if(AppUpdates.pagesRelease(pages,"0.10.0-beta.32")!=null)throw new Exception("Current release reported as upgrade");
        final int[] calls={0};AppUpdates.checkCatalog("0.10.0-beta.31",url->{calls[0]++;if(!url.equals(AppUpdates.MANIFEST))throw new Exception("Should not query GitHub when Pages works");return pages.toString();});if(calls[0]!=1)throw new Exception("Redundant catalog requests");
        pages.put("apk","https://example.com/update.apk");try{AppUpdates.pagesRelease(pages,"0.10.0-beta.31");throw new AssertionError("Foreign Pages APK accepted");}catch(IOException expected){}
        pages.put("apk","/downloads/ZNote-0.10.0-beta.32-android.apk").put("apk_sha256","invalid");try{AppUpdates.pagesRelease(pages,"0.10.0-beta.31");throw new AssertionError("Invalid Pages digest accepted");}catch(IOException expected){}
        asset.put("browser_download_url",AppUpdates.githubUrl("0.10.0-beta.11"));calls[0]=0;AppUpdates.Release fallback=AppUpdates.checkCatalog("0.10.0-beta.10",url->{calls[0]++;if(url.equals(AppUpdates.MANIFEST))throw new java.net.SocketTimeoutException();return new JSONArray().put(r).toString();});if(calls[0]!=2||fallback==null||!fallback.version.equals("0.10.0-beta.11"))throw new Exception("Independent catalog fallback failed");
        try{AppUpdates.checkCatalog("0.10.0-beta.10",url->{throw new IOException("HTTP 403");});throw new AssertionError("Total outage reported as latest");}catch(IOException expected){if(!expected.getMessage().contains("HTTP 403"))throw expected;}
    }
    void run()throws Exception{
        catalog();Context c=context();PackageInfo base=c.getPackageManager().getPackageInfo(c.getPackageName(),0);c.getSharedPreferences("MainActivity",0).edit().putString("update_marker","preserved").commit();
        JSONObject manifest;try(InputStream in=new java.net.URL("http://10.0.2.2:3744/manifest").openStream()){manifest=new JSONObject(new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));}
        AppUpdates.Release release=AppUpdates.Release.read(manifest);
        if(AppUpdates.compare(release.version,base.versionName)<=0)throw new Exception("Fixture must be a newer version than installed app");
        DownloadManager dm=(DownloadManager)c.getSystemService(Context.DOWNLOAD_SERVICE);AppUpdates.clear(c);
        long id=dm.enqueue(new DownloadManager.Request(Uri.parse("http://10.0.2.2:3744/update.apk")).setDestinationInExternalFilesDir(c,Environment.DIRECTORY_DOWNLOADS,"znote-update-"+release.version+".apk"));
        AppUpdates.prefs(c).edit().putLong("download_id",id).putString("release",release.json().toString()).commit();
        long end=SystemClock.uptimeMillis()+30000;boolean complete=false;
        while(SystemClock.uptimeMillis()<end){try(Cursor row=dm.query(new DownloadManager.Query().setFilterById(id))){if(row!=null&&row.moveToFirst()&&row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))==DownloadManager.STATUS_SUCCESSFUL){complete=true;break;}}Thread.sleep(250);}if(!complete)throw new Exception("System update download did not finish");
        File file=new File(c.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),"znote-update-"+release.version+".apk");
        try{AppUpdates.verify(c,file,new AppUpdates.Release(release.version,release.url,"0".repeat(64),release.size,""));throw new Exception("Corrupt digest accepted");}catch(IOException expected){}
        AppUpdates.verify(c,file,release);report("Update version, source, hash, signature and downloaded APK passed");
        Activity page=test.startActivitySync(new Intent(c,UpdateActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));tap("? 更新说明");tap("知道了");
        // Restore the screen while preserving Android's downloaded artifact.
        test.runOnMainSync(page::finish);Thread.sleep(300);page=test.startActivitySync(new Intent(c,UpdateActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Thread.sleep(800);android.graphics.Bitmap screenshot=automation().takeScreenshot();try(OutputStream out=new FileOutputStream(new File(c.getExternalFilesDir(null),"update-screen.png"))){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}screenshot.recycle();
        shell("appops set "+c.getPackageName()+" REQUEST_INSTALL_PACKAGES deny");tap("安装更新");Thread.sleep(400);shell("input keyevent 4");Thread.sleep(400);
        if(!file.exists())throw new Exception("Permission refusal deleted downloaded update");
        shell("appops set "+c.getPackageName()+" REQUEST_INSTALL_PACKAGES allow");tap("安装更新");awaitText("Update");tap("Cancel");awaitText("安装更新");
        if(!file.exists())throw new Exception("Installer cancellation deleted update");report("Update screen restore, permission refusal and installer cancellation passed");
        report("Opening installer again after cancellation");tap("安装更新");report("ZNOTE_UPDATE_INSTALL_CONFIRM");tap("Update");
        Thread.sleep(15000);throw new Exception("Self update did not replace the process");
    }
}
