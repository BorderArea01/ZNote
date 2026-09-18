package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
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
        if(AppUpdates.compare("0.10.0-beta.10","0.10.0-beta.9")<=0||AppUpdates.compare("0.10.0-beta.17","0.10.0-beta.16")<=0||AppUpdates.compare("0.10.0","0.10.0-beta.99")<=0)throw new Exception("Version order failed");
        JSONObject asset=new JSONObject().put("name","ZNote-0.10.0-beta.11-android.apk").put("browser_download_url",AppUpdates.REPOSITORY+"releases/download/android-v0.10.0-beta.11/ZNote-0.10.0-beta.11-android.apk").put("digest","sha256:"+"a".repeat(64)).put("size",123);
        JSONObject r=new JSONObject().put("draft",false).put("prerelease",true).put("assets",new JSONArray().put(asset));
        if(AppUpdates.latest(new JSONArray().put(r),"0.10.0-beta.10")==null)throw new Exception("Beta release missing");
        r.put("draft",true);if(AppUpdates.latest(new JSONArray().put(r),"0.10.0-beta.10")!=null)throw new Exception("Draft accepted");r.put("draft",false);asset.put("browser_download_url","https://example.com/update.apk");if(AppUpdates.latest(new JSONArray().put(r),"0.10.0-beta.10")!=null)throw new Exception("Foreign update source accepted");
    }
    void run()throws Exception{
        catalog();Context c=context();c.getSharedPreferences("MainActivity",0).edit().putString("update_marker","preserved").commit();
        JSONObject manifest;try(InputStream in=new java.net.URL("http://10.0.2.2:3744/manifest").openStream()){manifest=new JSONObject(new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));}
        AppUpdates.Release release=AppUpdates.Release.read(manifest);
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
