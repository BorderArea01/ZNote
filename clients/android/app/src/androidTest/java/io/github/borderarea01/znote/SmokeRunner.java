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
    private UiAutomation automation(){return getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);}
    private void checkpoint(String text){Bundle update=new Bundle();update.putString("stream","\n"+text+"\n");sendStatus(0,update);}
    private String nativeText(View v){String result=v instanceof TextView?((TextView)v).getText().toString()+" | ":"";if(v instanceof ViewGroup){ViewGroup group=(ViewGroup)v;for(int i=0;i<group.getChildCount();i++)result+=nativeText(group.getChildAt(i));}return result;}
    private void singleLineControls(View v){if(v instanceof TextView&&v.isClickable()&&((TextView)v).getLineCount()>1)throw new AssertionError("Floating control wraps: "+((TextView)v).getText());if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++)singleLineControls(g.getChildAt(i));}}
    private void screenshot(){try{android.graphics.Bitmap shot=automation().takeScreenshot();if(shot!=null)try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"client-smoke.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}}catch(Exception ignored){}}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private View find(View v,Class<?> type){if(type.isInstance(v))return v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){View r=find(g.getChildAt(i),type);if(r!=null)return r;}}return null;}
    private Button button(View v,String text){if(v instanceof Button&&((Button)v).getText().toString().equals(text))return(Button)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){Button b=button(g.getChildAt(i),text);if(b!=null)return b;}}return null;}
    private String js(String source)throws Exception{CompletableFuture<String> result=new CompletableFuture<>();runOnMainSync(()->{WebView web=(WebView)find(activity.getWindow().getDecorView(),WebView.class);if(web==null)result.complete("null");else web.evaluateJavascript(source,result::complete);});return result.get(8,TimeUnit.SECONDS);}
    private void until(String source)throws Exception{long deadline=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<deadline){if("true".equals(js(source)))return;Thread.sleep(250);}throw new Exception("WebView condition timed out: "+source+" body="+js("document.body.innerText.slice(0,400)+String(window.__result)"));}
    private void nativeUntil(Activity target,String expected)throws Exception{long deadline=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<deadline){String[] value={""};runOnMainSync(()->value[0]=nativeText(target.getWindow().getDecorView()));if(value[0].contains(expected))return;Thread.sleep(250);}throw new Exception("Native share did not reach: "+expected);}
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
    private android.graphics.Rect overlayControl(String text)throws Exception{
        long deadline=System.currentTimeMillis()+5000;
        while(System.currentTimeMillis()<deadline){for(android.view.accessibility.AccessibilityWindowInfo w:automation().getWindows()){
            if(w.getType()!=android.view.accessibility.AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY)continue;
            android.view.accessibility.AccessibilityNodeInfo root=w.getRoot();if(root==null)continue;
            for(android.view.accessibility.AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByText(text))if(text.contentEquals(n.getText()==null?"":n.getText())){android.graphics.Rect r=new android.graphics.Rect();n.getBoundsInScreen(r);return r;}
        }Thread.sleep(100);}throw new Exception("Overlay control unavailable: "+text);
    }
    private void overlayTouch(String text)throws Exception{
        android.graphics.Rect r=overlayControl(text);Thread.sleep(400);r=overlayControl(text);
        checkpoint("Overlay tap "+text+" at "+r);
        android.graphics.Bitmap shot=automation().takeScreenshot();try(java.io.OutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"capture-overlay.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}shot.recycle();
        long t=SystemClock.uptimeMillis();MotionEvent d=MotionEvent.obtain(t,t,0,r.centerX(),r.centerY(),0),u=MotionEvent.obtain(t,t+70,1,r.centerX(),r.centerY(),0);automation().injectInputEvent(d,true);automation().injectInputEvent(u,true);d.recycle();u.recycle();Thread.sleep(450);
    }
    private void shell(String command)throws Exception{try(android.os.ParcelFileDescriptor fd=automation().executeShellCommand(command);java.io.InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(fd)){in.readAllBytes();}}
    private Bundle captureCommand(String command)throws Exception{
        CompletableFuture<Bundle> result=new CompletableFuture<>();CaptureControl.send(getTargetContext(),command,new ResultReceiver(new Handler(Looper.getMainLooper())){@Override protected void onReceiveResult(int code,Bundle data){result.complete(data);}});return result.get(5,TimeUnit.SECONDS);
    }
    private void overlayTests()throws Exception{
        android.accessibilityservice.AccessibilityServiceInfo info=automation().getServiceInfo();info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;automation().setServiceInfo(info);
        shell("settings put secure enabled_accessibility_services io.github.borderarea01.znote/.CaptureAssistService");shell("settings put secure accessibility_enabled 1");
        Thread.sleep(1000);Bundle state=captureCommand("show");if(state.getInt("pid")==android.os.Process.myPid())throw new Exception("Capture must not share the WebView process");
        // An unsupported app must not have its content or old clipboard imported.
        android.graphics.Rect first=overlayControl("Z");Thread.sleep(400);first=overlayControl("Z");long started=SystemClock.uptimeMillis();
        MotionEvent firstDown=MotionEvent.obtain(started,started,0,first.centerX(),first.centerY(),0),firstUp=MotionEvent.obtain(started,started+60,1,first.centerX(),first.centerY(),0);
        automation().injectInputEvent(firstDown,true);automation().injectInputEvent(firstUp,true);firstDown.recycle();firstUp.recycle();
        overlayControl("获取当前页面");long elapsed=SystemClock.uptimeMillis()-started;if(elapsed>1200)throw new Exception("First bubble tap too slow: "+elapsed+"ms");checkpoint("First bubble tap expanded in "+elapsed+"ms");
        overlayTouch("获取当前页面");overlayControl("请在浏览器、小红书、抖音或 B 站作品页使用");overlayTouch("收起");
        android.graphics.Rect before=overlayControl("Z");long time=SystemClock.uptimeMillis();
        for(int i=0;i<=8;i++){float x=before.centerX()+(40-before.centerX())*(i/8f),y=before.centerY()+120*(i/8f);MotionEvent event=MotionEvent.obtain(time,time+i*35,i==0?MotionEvent.ACTION_DOWN:i==8?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE,x,y,0);automation().injectInputEvent(event,true);event.recycle();}
        Thread.sleep(300);android.graphics.Rect after=overlayControl("Z");if(after.left>20||Math.abs(after.top-before.top)<50)throw new Exception("Bubble failed to drag and dock left");
        captureCommand("hide");captureCommand("show");if(overlayControl("Z").left>20)throw new Exception("Dock position not retained");
        checkpoint("Floating capture drag, edge collapse, persisted placement and unsupported-page recovery passed");
        for(String pkg:new String[]{"com.chrome.beta","com.xingin.xhs","com.ss.android.ugc.aweme","tv.danmaku.bili"}){
            getTargetContext().startActivity(new Intent().setComponent(new ComponentName(pkg,"io.github.borderarea01.capturefixture.PageActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Thread.sleep(600);
            overlayTouch("Z");
            if(pkg.equals("com.chrome.beta")){android.graphics.Bitmap shot=automation().takeScreenshot();try(java.io.OutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"capture-overlay.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}shot.recycle();}
            ActivityMonitor monitor=addMonitor(ShareActivity.class.getName(),null,false);overlayTouch("获取当前页面");Activity captured=waitForMonitorWithTimeout(monitor,10000);removeMonitor(monitor);
            if(captured==null)throw new Exception("Current-page capture did not open for "+pkg);
            String expected=pkg.equals("com.chrome.beta")?"https://example.com/fixture-article":pkg.equals("com.xingin.xhs")?"https://xhslink.com/a/fixture-note":pkg.equals("tv.danmaku.bili")?"https://b23.tv/fixture-work":"https://v.douyin.com/fixture-work/";
            nativeUntil(captured,expected);runOnMainSync(captured::finish);Thread.sleep(350);
            checkpoint("On-demand current-link flow passed for simulated "+pkg);
        }
        getTargetContext().startActivity(new Intent().setComponent(new ComponentName("tv.danmaku.bili","io.github.borderarea01.capturefixture.PageActivity")).putExtra("list",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));Thread.sleep(600);
        overlayTouch("Z");overlayTouch("获取当前页面");overlayControl("当前页没有可采集的作品分享按钮，请先打开具体作品；列表页不支持整页采集");
        overlayTouch("收起");captureCommand("hide");captureCommand("show");overlayControl("Z");
        checkpoint("Bilibili list failure remains visible and floating window reopens without service restart");
        android.graphics.Rect point=overlayControl("Z");CountDownLatch entered=new CountDownLatch(1),released=new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(()->{entered.countDown();try{Thread.sleep(2500);}catch(InterruptedException ignored){}finally{released.countDown();}});entered.await();
        long begin=SystemClock.uptimeMillis();MotionEvent down=MotionEvent.obtain(begin,begin,0,point.centerX(),point.centerY(),0),up=MotionEvent.obtain(begin,begin+60,1,point.centerX(),point.centerY(),0);automation().injectInputEvent(down,true);automation().injectInputEvent(up,true);down.recycle();up.recycle();
        overlayControl("获取当前页面");long latency=SystemClock.uptimeMillis()-begin;if(latency>1200)throw new Exception("Host UI blocked floating window: "+latency+"ms");released.await();checkpoint("Floating window opens in "+latency+"ms while the library UI thread is blocked");
        overlayTouch("关闭");
        if(captureCommand("status").getBoolean("visible"))throw new Exception("Close did not hide the window");
        shell("settings put secure enabled_accessibility_services null");shell("settings put secure accessibility_enabled 0");
    }
    @Override public void onStart(){Bundle report=new Bundle();try{
        try{MainActivity.normalize("http://10.attacker.com");throw new Exception("public HTTP was accepted");}catch(Exception e){if(e.getMessage().equals("public HTTP was accepted"))throw e;}
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
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
        automation().executeShellCommand("input keyevent 4").close();
        until("!document.querySelector('.zoom-viewer')&&!!document.querySelector('.detail-dialog')");
        checkpoint("System Back closes zoom while retaining image detail");
        automation().executeShellCommand("input keyevent 4").close();
        until("!document.querySelector('[role=dialog]')&&!!document.querySelector('.item-card')");
        checkpoint("System Back closes image detail while retaining library");
        js("window.__refreshSeen=false;window.addEventListener('znote:refresh',()=>window.__refreshSeen=true,{once:true});true");
        touchText("↻");until("window.__refreshSeen===true&&!!document.querySelector('.item-card')");checkpoint("Visible native refresh updates library without reloading the WebView");
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
        ShareActivity share=(ShareActivity)startActivitySync(new Intent(getTargetContext(),ShareActivity.class).setAction(Intent.ACTION_SEND_MULTIPLE).setType("image/png").putParcelableArrayListExtra(Intent.EXTRA_STREAM,shares).putExtra(Intent.EXTRA_TEXT,"分享备注\n保留换行\nhttps://example.com/source").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_GRANT_READ_URI_PERMISSION));
        nativeUntil(share,"已连接");
        touchText("?");touchText("知道了");
        touchText("保存到知识库");nativeUntil(share,"已保存 2 个媒体文件");Thread.sleep(500);
        screenshot();checkpoint("Android system share streamed two images to the LAN server without local downloads");
        runOnMainSync(share::finish);Thread.sleep(500);
        js("window.__shareCheck='pending';fetch('/api/items?kind=image&grouped=false&limit=100').then(r=>r.json()).then(r=>{const items=r.items.filter(i=>i.source_url==='https://example.com/source');window.__shareCheck=items.length===2&&items.every(i=>i.group_key===items[0].group_key)?'ok':JSON.stringify(items)});true");
        until("window.__shareCheck==='ok'");checkpoint("Shared images retain a common group and clickable provenance");
        ShareActivity linkShare=(ShareActivity)startActivitySync(new Intent(getTargetContext(),ShareActivity.class).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,"测试失败恢复 http://127.0.0.1/private").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        nativeUntil(linkShare,"已连接");touchText("保存到知识库");
        nativeUntil(linkShare,"不能采集本机或内网地址");nativeUntil(linkShare,"重试采集");checkpoint("Shared links reach the server queue; failures remain visible with retry");
        runOnMainSync(linkShare::finish);
        for(android.net.Uri uri:shares)getTargetContext().getContentResolver().delete(uri,null,null);
        overlayTests();
        report.putString("stream","\nZNOTE_ANDROID_SMOKE_PASS\n");finish(Activity.RESULT_OK,report);
    }catch(Throwable e){String[] nativeState={""};if(activity!=null)runOnMainSync(()->nativeState[0]=nativeText(activity.getWindow().getDecorView()));String failure="\nZNOTE_ANDROID_SMOKE_FAIL: "+e+"\nNative UI: "+nativeState[0]+"\n";checkpoint(failure);screenshot();report.putString("stream",failure);finish(Activity.RESULT_CANCELED,report);}}
}
