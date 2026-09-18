package io.github.borderarea01.znote;
import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.util.concurrent.*;

// Runs in an isolated emulator against a disposable host library. No user device or data.
public class SmokeRunner extends Instrumentation {
    private MainActivity activity;
    private boolean updateUpgrade;
    private UiAutomation automation(){return getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);}
    private void checkpoint(String text){Bundle update=new Bundle();update.putString("stream","\n"+text+"\n");sendStatus(0,update);}
    private String nativeText(View v){String result=v instanceof TextView?((TextView)v).getText().toString()+" | ":"";if(v instanceof ViewGroup){ViewGroup group=(ViewGroup)v;for(int i=0;i<group.getChildCount();i++)result+=nativeText(group.getChildAt(i));}return result;}
    private void singleLineControls(View v){if(v instanceof TextView&&v.isClickable()&&((TextView)v).getLineCount()>1)throw new AssertionError("Floating control wraps: "+((TextView)v).getText());if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++)singleLineControls(g.getChildAt(i));}}
    private void screenshot(){try{android.graphics.Bitmap shot=automation().takeScreenshot();if(shot!=null)try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"client-smoke.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}}catch(Exception ignored){}}
    @Override public void onCreate(Bundle args){super.onCreate(args);updateUpgrade=args!=null&&"true".equals(args.getString("update_upgrade"));start();}
    private View find(View v,Class<?> type){if(type.isInstance(v))return v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){View r=find(g.getChildAt(i),type);if(r!=null)return r;}}return null;}
    private Button button(View v,String text){if(v instanceof Button&&((Button)v).getText().toString().equals(text))return(Button)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){Button b=button(g.getChildAt(i),text);if(b!=null)return b;}}return null;}
    private String js(String source)throws Exception{CompletableFuture<String> result=new CompletableFuture<>();runOnMainSync(()->{WebView web=(WebView)find(activity.getWindow().getDecorView(),WebView.class);if(web==null)result.complete("null");else web.evaluateJavascript(source,result::complete);});return result.get(8,TimeUnit.SECONDS);}
    private void until(String source)throws Exception{long deadline=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<deadline){if("true".equals(js(source)))return;Thread.sleep(250);}throw new Exception("WebView condition timed out: "+source+" body="+js("document.body.innerText.slice(0,400)+String(window.__result)"));}
    private void nativeUntil(Activity target,String expected)throws Exception{long deadline=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<deadline){String[] value={""};if(target==null){android.view.accessibility.AccessibilityNodeInfo r=automation().getRootInActiveWindow();value[0]=r!=null&&getTargetContext().getPackageName().contentEquals(r.getPackageName())&&!r.findAccessibilityNodeInfosByText(expected).isEmpty()?expected:"";}else runOnMainSync(()->value[0]=nativeText(target.getWindow().getDecorView()));if(value[0].contains(expected))return;Thread.sleep(250);}throw new Exception("Native share did not reach: "+expected);}
    private Activity openCapture(Intent intent)throws Exception{getTargetContext().startActivity(intent);Thread.sleep(500);return null;}
    private void closeCapture()throws Exception{shell("input keyevent 4");Thread.sleep(400);}
    private int diagnosticCount(String token)throws Exception{java.io.File file=new java.io.File(getTargetContext().getFilesDir(),"capture-diagnostics.log");if(!file.isFile())return 0;String value=new String(java.nio.file.Files.readAllBytes(file.toPath()),java.nio.charset.StandardCharsets.UTF_8);int count=0,at=0;while((at=value.indexOf(token,at))>=0){count++;at+=token.length();}return count;}
    private void touchText(String text)throws Exception{
        waitForIdleSync();long deadline=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<deadline){android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();
            if(root!=null)for(android.view.accessibility.AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(text))if(text.contentEquals(node.getText()==null?"":node.getText())){
                android.graphics.Rect bounds=new android.graphics.Rect();node.getBoundsInScreen(bounds);long time=SystemClock.uptimeMillis();
                MotionEvent down=MotionEvent.obtain(time,time,MotionEvent.ACTION_DOWN,bounds.centerX(),bounds.centerY(),0),up=MotionEvent.obtain(time,time+80,MotionEvent.ACTION_UP,bounds.centerX(),bounds.centerY(),0);
                automation().injectInputEvent(down,true);automation().injectInputEvent(up,true);down.recycle();up.recycle();Thread.sleep(300);return;
            }Thread.sleep(100);
        }throw new Exception("Touchable control not found: "+text);
    }
    private void clickText(String text)throws Exception{
        long deadline=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<deadline){android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();
            boolean clicked=false;if(root!=null){for(android.view.accessibility.AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(text)){
                if(text.contentEquals(node.getText()==null?"":node.getText())&&node.isClickable()){clicked=node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK);node.recycle();break;}node.recycle();
            }root.recycle();}if(clicked){Thread.sleep(300);return;}Thread.sleep(100);
        }throw new Exception("Accessible control click failed: "+text);
    }
    private android.graphics.Rect overlayControl(String text)throws Exception{
        long deadline=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<deadline){for(android.view.accessibility.AccessibilityWindowInfo w:automation().getWindows()){
            if(w.getType()!=android.view.accessibility.AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY)continue;
            android.view.accessibility.AccessibilityNodeInfo root=w.getRoot();if(root==null)continue;
            String[] candidates="Z".equals(text)||"⋮".equals(text)?new String[]{"Z","⋮","✓","!"}:new String[]{text};for(String candidate:candidates)for(android.view.accessibility.AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByText(candidate))if(candidate.contentEquals(n.getText()==null?"":n.getText())){android.graphics.Rect r=new android.graphics.Rect();n.getBoundsInScreen(r);if(("Z".equals(text)||"⋮".equals(text))&&r.left>20&&r.right<getTargetContext().getResources().getDisplayMetrics().widthPixels-20)continue;return r;}
        }Thread.sleep(100);}throw new Exception("Overlay control unavailable: "+text);
    }
    private void overlayMessage(String text)throws Exception{
        long deadline=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<deadline){for(android.view.accessibility.AccessibilityWindowInfo w:automation().getWindows()){
            if(w.getType()!=android.view.accessibility.AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY)continue;
            android.view.accessibility.AccessibilityNodeInfo root=w.getRoot();if(root==null)continue;
            for(android.view.accessibility.AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByText(text)){
                CharSequence value=n.getText();if(value!=null&&value.toString().contains(text))return;
                CharSequence description=n.getContentDescription();if(description!=null&&description.toString().contains(text))return;
            }
        }Thread.sleep(100);}throw new Exception("Overlay message unavailable: "+text);
    }
    private void overlayTouch(String text)throws Exception{
        android.graphics.Rect r=overlayControl(text);Thread.sleep(400);r=overlayControl(text);
        checkpoint("Overlay tap "+text+" at "+r);
        android.graphics.Bitmap shot=automation().takeScreenshot();try(java.io.OutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"capture-overlay.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}shot.recycle();
        long t=SystemClock.uptimeMillis();MotionEvent d=MotionEvent.obtain(t,t,0,r.centerX(),r.centerY(),0);automation().injectInputEvent(d,true);MotionEvent u=MotionEvent.obtain(t,SystemClock.uptimeMillis(),1,r.centerX(),r.centerY(),0);automation().injectInputEvent(u,true);d.recycle();u.recycle();Thread.sleep(450);
    }
    private void shell(String command)throws Exception{try(android.os.ParcelFileDescriptor fd=automation().executeShellCommand(command);java.io.InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(fd)){in.readAllBytes();}}
    private Bundle captureCommand(String command)throws Exception{
        getTargetContext().startActivity(new Intent(getTargetContext(),CaptureAssistActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Thread.sleep(400);
        if(!"status".equals(command))clickText("show".equals(command)?"显示悬浮窗":"关闭悬浮窗");
        long deadline=SystemClock.uptimeMillis()+5000;Bundle state=null;
        while(SystemClock.uptimeMillis()<deadline){android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();
            if(root!=null){for(android.view.accessibility.AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText("采集辅助已连接")){String text=String.valueOf(node.getText());boolean visible=text.contains("悬浮窗已显示");if("status".equals(command)||visible=="show".equals(command)){state=new Bundle();state.putBoolean("visible",visible);}node.recycle();}root.recycle();}if(state!=null)break;Thread.sleep(100);
        }
        if(state==null)throw new Exception("Capture settings could not control window: "+command);
        for(ActivityManager.RunningAppProcessInfo process:((ActivityManager)getTargetContext().getSystemService(Context.ACTIVITY_SERVICE)).getRunningAppProcesses())if(process.processName.equals(getTargetContext().getPackageName()+":capture"))state.putInt("pid",process.pid);
        android.graphics.Bitmap settingsShot=automation().takeScreenshot();try(java.io.OutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"capture-settings.png"))){settingsShot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}settingsShot.recycle();
        shell("input keyevent 4");Thread.sleep(250);return state;
    }
    private long panelLatency(long budget)throws Exception{
        String log;try(android.os.ParcelFileDescriptor fd=automation().executeShellCommand("logcat -d -s ZNoteCapture:I *:S");java.io.InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(fd)){log=new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
        java.util.regex.Matcher match=java.util.regex.Pattern.compile("panel_frame ms=(\\d+)").matcher(log);long last=-1;while(match.find())last=Long.parseLong(match.group(1));if(last<0||last>budget)throw new Exception("Floating touch-to-frame latency: "+last+"ms");return last;
    }
    private void overlayTests()throws Exception{
        android.accessibilityservice.AccessibilityServiceInfo info=automation().getServiceInfo();info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;automation().setServiceInfo(info);
        shell("pm grant io.github.borderarea01.znote android.permission.POST_NOTIFICATIONS");shell("settings put secure enabled_accessibility_services io.github.borderarea01.znote/.CaptureAssistService");shell("settings put secure accessibility_enabled 1");
        Thread.sleep(1000);Bundle state=captureCommand("show");if(state.getInt("pid")==0||state.getInt("pid")==android.os.Process.myPid())throw new Exception("Capture must not share the WebView process");
        // An unsupported app must not have its content or old clipboard imported.
        android.graphics.Rect first=overlayControl("Z");Thread.sleep(400);first=overlayControl("Z");long started=SystemClock.uptimeMillis();
        MotionEvent firstDown=MotionEvent.obtain(started,started,0,first.centerX(),first.centerY(),0);automation().injectInputEvent(firstDown,true);firstDown.recycle();
        MotionEvent firstUp=MotionEvent.obtain(started,SystemClock.uptimeMillis(),1,first.centerX(),first.centerY(),0);automation().injectInputEvent(firstUp,true);firstUp.recycle();
        overlayControl("采集当前作品");checkpoint("First floating touch-to-frame (includes cold text rendering): "+panelLatency(1500)+"ms");
        overlayTouch("采集当前作品");overlayMessage("请回到要采集的作品页");overlayTouch("未分类  ▾");overlayControl("未分类");overlayTouch("未分类");overlayTouch("⠿  ZNote  ⌄");
        android.graphics.Rect before=overlayControl("Z");long time=SystemClock.uptimeMillis();
        for(int i=0;i<=8;i++){float x=before.centerX()+(40-before.centerX())*(i/8f),y=before.centerY()+120*(i/8f);MotionEvent event=MotionEvent.obtain(time,SystemClock.uptimeMillis(),i==0?MotionEvent.ACTION_DOWN:i==8?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE,x,y,0);automation().injectInputEvent(event,true);event.recycle();Thread.sleep(40);}
        Thread.sleep(300);android.graphics.Rect after=overlayControl("Z");if(after.left>20||Math.abs(after.top-before.top)<50)throw new Exception("Bubble failed to drag and dock left: "+before+" -> "+after);
        captureCommand("hide");captureCommand("show");android.graphics.Rect restored=overlayControl("Z");if(restored.left>20||Math.abs(restored.top-after.top)>15)throw new Exception("Dock position not retained: "+after+" -> "+restored);
        if(restored.width()>getTargetContext().getResources().getDisplayMetrics().density*40||restored.height()<getTargetContext().getResources().getDisplayMetrics().density*52||restored.height()>getTargetContext().getResources().getDisplayMetrics().density*62)throw new Exception("Collapsed handle is not a compact half-circle tab");
        android.app.NotificationManager nm=(android.app.NotificationManager)getTargetContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if(java.util.Arrays.stream(nm.getActiveNotifications()).noneMatch(n->n.getId()==3741))throw new Exception("Capture management notification missing");
        if(java.util.Arrays.stream(nm.getActiveNotifications()).noneMatch(n->n.getId()==3741&&(n.getNotification().flags&Notification.FLAG_FOREGROUND_SERVICE)!=0))throw new Exception("Visible capture window must be managed by a foreground service");
        checkpoint("Floating capture drag, compact handle, notification, persisted placement and unsupported-page recovery passed");
        for(String pkg:new String[]{"com.chrome.beta","org.example.reader","com.xingin.xhs","com.ss.android.ugc.aweme","tv.danmaku.bili"}){
            getTargetContext().startActivity(new Intent().setComponent(new ComponentName(pkg,"io.github.borderarea01.capturefixture.PageActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));Thread.sleep(600);
            overlayTouch("Z");
            if(pkg.equals("com.chrome.beta")){android.graphics.Bitmap shot=automation().takeScreenshot();try(java.io.OutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"capture-overlay.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}shot.recycle();}
            int queuedBefore=diagnosticCount("capture_queued"),directBefore=diagnosticCount("direct_share_received");overlayTouch("采集当前作品");
            String expected=pkg.equals("com.chrome.beta")?"https://example.com/fixture-article":pkg.equals("org.example.reader")?"https://reader.example/fixture-work":pkg.equals("com.xingin.xhs")?"https://xhslink.cn/a/fixture-note":pkg.equals("tv.danmaku.bili")?"https://b23.tv/fixture-work":"https://v.douyin.com/fixture-work/";
            long queued=SystemClock.uptimeMillis()+8000;boolean resumed=false;
            while(SystemClock.uptimeMillis()<queued){android.view.accessibility.AccessibilityNodeInfo root=automation().getRootInActiveWindow();if(diagnosticCount("capture_queued")>queuedBefore&&root!=null&&!"io.github.borderarea01.znote".contentEquals(root.getPackageName())){resumed=true;break;}Thread.sleep(100);}
            if(!resumed)throw new Exception("Quick capture blocked browsing for "+pkg+" ("+expected+")");
            if(!pkg.equals("com.chrome.beta")&&diagnosticCount("direct_share_received")<=directBefore)throw new Exception("Android direct-share target was not used for "+pkg);
            overlayTouch("Z");overlayTouch("⠿  ZNote  ⌄");
            checkpoint("Direct Android share-target flow queued in background and returned to simulated "+pkg);
        }
        getTargetContext().startActivity(new Intent().setComponent(new ComponentName("com.xingin.xhs","io.github.borderarea01.capturefixture.PageActivity")).putExtra("copyOnly",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));Thread.sleep(600);
        overlayTouch("Z");int clipboardQueued=diagnosticCount("capture_queued");overlayTouch("采集当前作品");long clipboardDeadline=SystemClock.uptimeMillis()+8000;while(diagnosticCount("capture_queued")<=clipboardQueued&&SystemClock.uptimeMillis()<clipboardDeadline)Thread.sleep(100);if(diagnosticCount("capture_queued")<=clipboardQueued)throw new Exception("Clipboard transport fallback did not queue");checkpoint("Copy-link fallback remains available when the source share sheet does not expose ZNote");
        getTargetContext().startActivity(new Intent().setComponent(new ComponentName("com.ss.android.ugc.aweme","io.github.borderarea01.capturefixture.PageActivity")).putExtra("copyOnly",true).putExtra("menuOpen",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));Thread.sleep(800);
        int manualDouyinQueued=diagnosticCount("capture_queued");overlayTouch("Z");overlayTouch("采集当前作品");long manualDouyinDeadline=SystemClock.uptimeMillis()+8000;while(diagnosticCount("capture_queued")<=manualDouyinQueued&&SystemClock.uptimeMillis()<manualDouyinDeadline)Thread.sleep(100);if(diagnosticCount("capture_queued")<=manualDouyinQueued)throw new Exception("Already-open Douyin share menu did not auto-copy and save its URL");checkpoint("Icon-only Douyin share action and an already-open copy menu auto-read the URL without manual paste");
        long resultDeadline=SystemClock.uptimeMillis()+30000;while(diagnosticCount("capture_result")==0&&SystemClock.uptimeMillis()<resultDeadline)Thread.sleep(250);if(diagnosticCount("capture_result")==0)throw new Exception("Background capture result was not observed");
        if(java.util.Arrays.stream(nm.getActiveNotifications()).noneMatch(n->"capture_results".equals(n.getNotification().getChannelId())))throw new Exception("Background capture result notification missing");checkpoint("Background capture completion or failure remains visible after the floating panel closes");
        FloatingShareActivity fallback=(FloatingShareActivity)openCapture(new Intent(getTargetContext(),FloatingShareActivity.class).putExtra("read_clipboard",true).putExtra("copied_after",System.currentTimeMillis()+60000).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        nativeUntil(fallback,"链接还没带进来");nativeUntil(fallback,"未读到本次分享链接");
        touchText("去浏览");nativeUntil(activity,"我的知识库");shell("input keyevent 4");Thread.sleep(400);nativeUntil(fallback,"未读到本次分享链接");checkpoint("Floating save panel can open the library and return without discarding the pending share");
        runOnMainSync(()->((android.content.ClipboardManager)getTargetContext().getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(android.content.ClipData.newPlainText("fixture","http://127.0.0.1/manual-fallback")));
        touchText("读取剪贴板");nativeUntil(fallback,"http://127.0.0.1/manual-fallback");
        android.graphics.Bitmap shot=automation().takeScreenshot();try(java.io.OutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"capture-panel.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}shot.recycle();
        int manualQueued=diagnosticCount("capture_queued");touchText("保存到知识库");long manualDeadline=SystemClock.uptimeMillis()+5000;while(diagnosticCount("capture_queued")<=manualQueued&&SystemClock.uptimeMillis()<manualDeadline)Thread.sleep(100);if(diagnosticCount("capture_queued")<=manualQueued)throw new Exception("Manual paste was not queued before the panel closed");
        checkpoint("Stale clipboard is rejected; explicit paste queues in the background and closes the small panel");
        getTargetContext().startActivity(new Intent().setComponent(new ComponentName("tv.danmaku.bili","io.github.borderarea01.capturefixture.PageActivity")).putExtra("slow",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));Thread.sleep(600);
        overlayTouch("Z");overlayTouch("采集当前作品");overlayTouch("…");overlayTouch("取消识别");overlayControl("已取消，可重新采集");overlayTouch("⠿  ZNote  ⌄");overlayTouch("Z");overlayControl("采集当前作品");
        Thread.sleep(1500);if("io.github.borderarea01.znote".contentEquals(automation().getRootInActiveWindow().getPackageName()))throw new Exception("Cancelled capture opened a stale share page");overlayTouch("⠿  ZNote  ⌄");checkpoint("Slow provider remains cancellable; window reopens and late results do not navigate");
        getTargetContext().startActivity(new Intent().setComponent(new ComponentName("tv.danmaku.bili","io.github.borderarea01.capturefixture.PageActivity")).putExtra("list",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));Thread.sleep(600);
        overlayTouch("Z");overlayTouch("采集当前作品");overlayControl("当前页没有可识别的分享入口");
        overlayTouch("⠿  ZNote  ⌄");captureCommand("hide");captureCommand("show");overlayControl("Z");
        checkpoint("Bilibili list failure remains visible and floating window reopens without service restart");
        getTargetContext().startActivity(new Intent().setComponent(new ComponentName("com.chrome.beta","io.github.borderarea01.capturefixture.PageActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));Thread.sleep(600);
        android.graphics.Rect point=overlayControl("Z");CountDownLatch entered=new CountDownLatch(1),released=new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(()->{entered.countDown();try{Thread.sleep(6000);}catch(InterruptedException ignored){}finally{released.countDown();}});entered.await();
        long begin=SystemClock.uptimeMillis();MotionEvent down=MotionEvent.obtain(begin,begin,0,point.centerX(),point.centerY(),0);automation().injectInputEvent(down,true);down.recycle();MotionEvent up=MotionEvent.obtain(begin,SystemClock.uptimeMillis(),1,point.centerX(),point.centerY(),0);automation().injectInputEvent(up,true);up.recycle();
        overlayControl("采集当前作品");overlayTouch("粘贴链接");nativeUntil(null,"保存这条作品");boolean independent=released.getCount()>0;released.await();if(!independent)throw new Exception("Floating panel waited for the blocked library process");checkpoint("Floating handle and native capture Activity respond above another app while library thread is blocked: "+panelLatency(600)+"ms");
        closeCapture();Bundle hidden=captureCommand("hide");if(hidden.getBoolean("visible"))throw new Exception("Close did not hide the window");
        if(captureCommand("status").getInt("pid")!=state.getInt("pid"))throw new Exception("Capture process restarted during window interactions");
        String diagnostics=new String(java.nio.file.Files.readAllBytes(new java.io.File(getTargetContext().getFilesDir(),"capture-diagnostics.log").toPath()),java.nio.charset.StandardCharsets.UTF_8);
        if(!diagnostics.contains("process_start")||!diagnostics.contains("panel_frame")||!diagnostics.contains("toggle open"))throw new Exception("Persistent capture diagnostics missing");
        checkpoint("Repeated window interactions retain one process and persistent startup/frame diagnostics");
        shell("settings put secure enabled_accessibility_services null");shell("settings put secure accessibility_enabled 0");
    }
    @Override public void onStart(){Bundle report=new Bundle();try{
        if(updateUpgrade){new UpdateSmoke(this).run();return;}
        UpdateSmoke.catalog();
        long serverDeadline=SystemClock.uptimeMillis()+30000;boolean reachable=false;
        while(SystemClock.uptimeMillis()<serverDeadline){java.net.HttpURLConnection probe=(java.net.HttpURLConnection)new java.net.URL("http://10.0.2.2:3742/api/health").openConnection();probe.setConnectTimeout(2000);probe.setReadTimeout(2000);try{if(probe.getResponseCode()==200){reachable=true;break;}}catch(java.io.IOException ignored){}finally{probe.disconnect();}Thread.sleep(300);}
        if(!reachable)throw new Exception("Disposable host server is not reachable from emulator");
        try{MainActivity.normalize("http://10.attacker.com");throw new Exception("public HTTP was accepted");}catch(Exception e){if(e.getMessage().equals("public HTTP was accepted"))throw e;}
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));nativeUntil(activity,"连接到你的知识库");
        runOnMainSync(()->{EditText address=(EditText)find(activity.getWindow().getDecorView(),EditText.class);address.setText("http://10.0.2.2:3742");button(activity.getWindow().getDecorView(),"连接并打开").performClick();});
        until("!!document.querySelector('input[type=password]')");
        checkpoint("Android connected to disposable LAN server");
        js("(()=>{const i=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'0427');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.form.requestSubmit();return true})()");
        until("document.body.innerText.includes('我的知识库')");
        checkpoint("Android password setup complete");
        js("window.__result='pending';(async()=>{try{const f=new FormData();const canvas=document.createElement('canvas');canvas.width=canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);const b=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));f.append('file',b,'android-smoke.png');const r=await fetch('/api/assets',{method:'POST',body:f});window.__result=r.ok?'ok':'http-'+r.status}catch(e){window.__result=String(e)}})();true");
        until("window.__result==='ok'");
        checkpoint("Android image upload complete");
        until("!!document.querySelector('.library-card:not(.new-library)')");
        js("document.querySelector('.library-card:not(.new-library)').click();true");
        until("document.body.innerText.includes('android-smoke.png')&&!!document.querySelector('.item-card img')&&document.querySelector('.item-card img').complete&&document.querySelector('.item-card img').naturalWidth>0");
        // Verify renderer and native upload/download hooks coexist with the actual app.
        until("typeof ZNoteDownloads.markdown==='function'&&!!document.querySelector('input[type=file]')");
        js("document.querySelector('.card-main').click();true");
        until("!!document.querySelector('.detail-dialog')");
        js("document.querySelector('.image-stage button').click();true");
        until("!!document.querySelector('.zoom-viewer')");
        shell("input keyevent 4");Thread.sleep(800);
        // The headless emulator can drop the first injected Back event while
        // the WebView is still taking focus. Retry only if the zoom layer is
        // demonstrably still open; a real successful Back is never doubled.
        if("true".equals(js("!!document.querySelector('.zoom-viewer')")))shell("input keyevent 4");
        until("!document.querySelector('.zoom-viewer')&&!!document.querySelector('.detail-dialog')");
        checkpoint("System Back closes zoom while retaining image detail");
        automation().executeShellCommand("input keyevent 4").close();
        until("!document.querySelector('[role=dialog]')&&!!document.querySelector('.item-card')");
        checkpoint("System Back closes image detail while retaining library");
        js("window.__refreshSeen=false;window.__beforeRefresh=document.querySelector('.card-main');window.addEventListener('znote:refresh',()=>window.__refreshSeen=true,{once:true});true");
        touchText("⋯");touchText("刷新知识库");until("window.__refreshSeen===true&&!window.__beforeRefresh.isConnected&&!document.querySelector('.loading-state')&&!!document.querySelector('.item-card')");checkpoint("Visible native refresh updates library without reloading the WebView");
        js("document.querySelector('.card-main').click();true");until("!!document.querySelector('.detail-dialog')");
        runOnMainSync(()->button(activity.getWindow().getDecorView(),"‹").performClick());
        until("!document.querySelector('[role=dialog]')&&!!document.querySelector('.item-card')");
        if(activity.isFinishing()||activity.isDestroyed())throw new Exception("Back destroyed the client");
        Intent probe=new Intent(Intent.ACTION_SEND).setType("text/plain");
        if(getTargetContext().getPackageManager().queryIntentActivities(probe,0).stream().noneMatch(r->r.activityInfo.name.endsWith("ShareActivity")))throw new Exception("Share entry is missing from the system resolver");
        java.util.ArrayList<android.net.Uri> shares=new java.util.ArrayList<>();
        for(int i=0;i<2;i++){
            ContentValues values=new ContentValues();values.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,"share-smoke-"+i+".png");values.put(android.provider.MediaStore.Images.Media.MIME_TYPE,"image/png");
            android.net.Uri uri=getTargetContext().getContentResolver().insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);
            android.graphics.Bitmap bmp=android.graphics.Bitmap.createBitmap(80,60,android.graphics.Bitmap.Config.ARGB_8888);bmp.eraseColor(i==0?0xff6171bd:0xff7c9f70);
            try(java.io.OutputStream out=getTargetContext().getContentResolver().openOutputStream(uri)){bmp.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}bmp.recycle();shares.add(uri);
        }
        ShareActivity share=(ShareActivity)openCapture(new Intent(getTargetContext(),ShareActivity.class).setAction(Intent.ACTION_SEND_MULTIPLE).setType("image/png").putParcelableArrayListExtra(Intent.EXTRA_STREAM,shares).putExtra(Intent.EXTRA_TEXT,"分享备注\n保留换行\nhttps://example.com/source").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_GRANT_READ_URI_PERMISSION));
        nativeUntil(share,"已连接");
        touchText("?");touchText("知道了");
        touchText("保存到知识库");nativeUntil(share,"已保存 2 个媒体文件");Thread.sleep(500);
        screenshot();checkpoint("Android system share streamed two images to the LAN server without local downloads");touchText("继续采集");nativeUntil(null,"已连接");touchText("保存到知识库");nativeUntil(null,"请粘贴一个作品链接");checkpoint("Completed capture resets for the next item without a disabled saved button");
        closeCapture();Thread.sleep(500);
        js("window.__shareCheck='pending';fetch('/api/items?kind=image&grouped=false&limit=100').then(r=>r.json()).then(r=>{const items=r.items.filter(i=>i.source_url==='https://example.com/source');window.__shareCheck=items.length===2&&items.every(i=>i.group_key===items[0].group_key)?'ok':JSON.stringify(items)});true");
        until("window.__shareCheck==='ok'");checkpoint("Shared images retain a common group and clickable provenance");
        ShareActivity linkShare=(ShareActivity)openCapture(new Intent(getTargetContext(),ShareActivity.class).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,"测试失败恢复 http://127.0.0.1/private").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        nativeUntil(linkShare,"已连接");touchText("保存到知识库");
        nativeUntil(linkShare,"不能采集本机或内网地址");nativeUntil(linkShare,"重试采集");checkpoint("Shared links reach the server queue; failures remain visible with retry");
        closeCapture();
        for(android.net.Uri uri:shares)getTargetContext().getContentResolver().delete(uri,null,null);
        overlayTests();
        report.putString("stream","\nZNOTE_ANDROID_SMOKE_PASS\n");finish(Activity.RESULT_OK,report);
    }catch(Throwable e){String[] nativeState={""};if(activity!=null)runOnMainSync(()->nativeState[0]=nativeText(activity.getWindow().getDecorView()));String failure="\nZNOTE_ANDROID_SMOKE_FAIL: "+e+"\nNative UI: "+nativeState[0]+"\n";checkpoint(failure);if(activity!=null)screenshot();report.putString("stream",failure);finish(Activity.RESULT_CANCELED,report);}}
}
