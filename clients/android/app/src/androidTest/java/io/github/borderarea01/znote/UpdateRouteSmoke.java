package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.*;
import java.io.*;
import java.security.MessageDigest;

/** Real native update screen + system download, only in a disposable emulator. */
final class UpdateRouteSmoke {
    final Instrumentation test; final boolean publicNetwork;
    UpdateRouteSmoke(Instrumentation test,boolean publicNetwork){this.test=test;this.publicNetwork=publicNetwork;}
    byte[] all(InputStream in)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}
    void report(String value){Bundle b=new Bundle();b.putString("stream","\n"+value+"\n");test.sendStatus(0,b);}
    void text(String value,boolean tap)throws Exception{
        long end=SystemClock.uptimeMillis()+30000;
        while(SystemClock.uptimeMillis()<end){AccessibilityNodeInfo root=test.getUiAutomation().getRootInActiveWindow();if(root!=null)for(AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByText(value))if(value.equals(String.valueOf(n.getText()))&&n.isVisibleToUser()&&n.isEnabled()){
            if(tap){android.graphics.Rect r=new android.graphics.Rect();n.getBoundsInScreen(r);long now=SystemClock.uptimeMillis();for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent e=MotionEvent.obtain(now,now+60,action,r.centerX(),r.centerY(),0);e.setSource(InputDevice.SOURCE_TOUCHSCREEN);test.getUiAutomation().injectInputEvent(e,true);e.recycle();}}return;
        }Thread.sleep(150);}throw new Exception("Missing update control: "+value);
    }
    void run()throws Exception{
        Context c=test.getTargetContext();UpdateSmoke.catalog();AppUpdates.clear(c);
        long now=System.currentTimeMillis();
        if(AppUpdates.stalled(c,DownloadManager.STATUS_RUNNING,0,0,now))throw new Exception("Fresh download marked stalled");
        if(!AppUpdates.stalled(c,DownloadManager.STATUS_RUNNING,0,0,now+21000))throw new Exception("Stalled download undetected");
        if(AppUpdates.stalled(c,DownloadManager.STATUS_PAUSED,DownloadManager.PAUSED_WAITING_FOR_NETWORK,0,now+22000))throw new Exception("Offline download incorrectly switched source");
        if(AppUpdates.stalled(c,DownloadManager.STATUS_RUNNING,0,20,now+23000))throw new Exception("Progress failed to reset deadline");
        AppUpdates.clear(c);
        // Use the real HTTP client against a local 503/403 fixture; no mutable
        // production update URL or credential is introduced into the APK.
        final int[] calls={0};AppUpdates.Release fixture=AppUpdates.checkCatalog("0.10.0-beta.1",url->{calls[0]++;try{return AppUpdates.readCatalog("http://10.0.2.2:3748/"+(url.equals(AppUpdates.MANIFEST)?"unavailable":"github"),java.net.Proxy.NO_PROXY);}catch(Exception e){report("Fixture request: "+e);throw e;}});
        if(fixture==null||calls[0]!=2)throw new Exception("HTTP catalog fallback failed");
        long start=SystemClock.uptimeMillis();AppUpdates.checkCatalog("0.10.0-beta.1",url->AppUpdates.readCatalog("http://10.0.2.2:3748/"+(url.equals(AppUpdates.MANIFEST)?"hang":"github"),java.net.Proxy.NO_PROXY));
        if(SystemClock.uptimeMillis()-start>12000)throw new Exception("Catalog timeout not bounded");
        report("Pages validation, independent HTTP fallback, bounded timeout, progress and offline guards passed");
        if(!publicNetwork){report("ZNOTE_UPDATE_ROUTES_PASS");return;}
        try(ParcelFileDescriptor fd=test.getUiAutomation().executeShellCommand("settings put global http_proxy 10.0.2.2:7897");InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)){all(in);}Thread.sleep(800);
        JSONObject manifest=new JSONObject(AppUpdates.readCatalog(AppUpdates.MANIFEST));AppUpdates.Release pages=AppUpdates.pagesRelease(manifest,"0.0.0");
        if(pages==null)throw new Exception("No public signed release");
        // GitHub first simulates a previously queued old-client download. The
        // system manager really fails it, and the production fallback must
        // switch it once to Pages and preserve the verified metadata.
        AppUpdates.Release release=new AppUpdates.Release(pages.version,AppUpdates.githubUrl(pages.version),pages.hash,pages.size,pages.notes);
        DownloadManager dm=(DownloadManager)c.getSystemService(Context.DOWNLOAD_SERVICE);
        long id=dm.enqueue(new DownloadManager.Request(Uri.parse(AppUpdates.REPOSITORY+"releases/download/znote-nonexistent/not-a-release.apk")).setDestinationInExternalFilesDir(c,Environment.DIRECTORY_DOWNLOADS,"test-failed-update.apk"));
        AppUpdates.prefs(c).edit().putLong("download_id",id).putString("release",release.json().toString()).putInt("download_attempt",0).commit();
        // The public APK may be older than this development test build; use
        // an explicitly newer test catalog version only for UI lifecycle.
        // Verify network download via the manager directly, not fake install.
        long deadline=SystemClock.uptimeMillis()+30000;boolean failed=false;
        while(SystemClock.uptimeMillis()<deadline){try(Cursor row=dm.query(new DownloadManager.Query().setFilterById(id))){if(row!=null&&row.moveToFirst()&&row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))==DownloadManager.STATUS_FAILED){failed=true;break;}}Thread.sleep(200);}if(!failed)throw new Exception("Expected failed system download");
        if(!AppUpdates.alternate(c,id,release))throw new Exception("Fallback not enqueued");
        long alternate=AppUpdates.prefs(c).getLong("download_id",0);if(AppUpdates.alternate(c,alternate,release))throw new Exception("Fallback loop allowed");
        deadline=SystemClock.uptimeMillis()+60000;boolean done=false;
        while(SystemClock.uptimeMillis()<deadline){try(Cursor row=dm.query(new DownloadManager.Query().setFilterById(alternate))){if(row!=null&&row.moveToFirst()){int state=row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));if(state==DownloadManager.STATUS_FAILED)throw new Exception("Public system download failed: "+row.getInt(row.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)));if(state==DownloadManager.STATUS_SUCCESSFUL){done=true;break;}}}Thread.sleep(250);}if(!done)throw new Exception("Public system download timed out");
        File downloaded=AppUpdates.downloadedFile(c,release);byte[] bytes;try(InputStream in=new FileInputStream(downloaded)){bytes=all(in);}StringBuilder hash=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));if(bytes.length!=release.size||!hash.toString().equals(release.hash))throw new Exception("Public APK bytes differ from catalog");
        if(!AppUpdates.prefs(c).getString("release","").contains(release.hash))throw new Exception("Fallback changed expected digest");
        AppUpdates.clear(c);if(downloaded.exists())throw new Exception("Cancel left update APK behind");
        report("Proxy-enabled public Pages manifest and system APK download passed; failed-source switch is bounded and original hash/size preserved");
        String current=AppUpdates.installedVersion(c),next=current.replaceFirst("beta\\.([0-9]+)$","beta."+(Integer.parseInt(current.substring(current.lastIndexOf('.')+1))+1));
        AppUpdates.Release pending=new AppUpdates.Release(next,AppUpdates.pagesUrl(next),release.hash,release.size,"验收用未发布版本，不安装");
        long pendingId=dm.enqueue(new DownloadManager.Request(Uri.parse("http://10.0.2.2:3748/hang")).setDestinationInExternalFilesDir(c,Environment.DIRECTORY_DOWNLOADS,"test-cancel-update.apk"));
        AppUpdates.prefs(c).edit().putLong("download_id",pendingId).putString("release",pending.json().toString()).commit();
        Activity cancelScreen=test.startActivitySync(new Intent(c,UpdateActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));text("取消下载",true);text("已取消下载",false);if(AppUpdates.prefs(c).getLong("download_id",0)!=0)throw new Exception("Native cancellation retained system task");test.runOnMainSync(cancelScreen::finish);
        Activity screen=test.startActivitySync(new Intent(c,UpdateActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));text("已是当前最新版本",false);text("? 更新说明",true);text("知道了",true);
        android.graphics.Bitmap shot=test.getUiAutomation().takeScreenshot();try(OutputStream out=new FileOutputStream(new File(c.getFilesDir(),"update-routes.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}shot.recycle();test.runOnMainSync(screen::finish);
        report("ZNOTE_UPDATE_ROUTES_PASS");
    }
}
