package io.github.borderarea01.znote;
import android.app.*;import android.content.*;import android.graphics.*;import android.os.*;import android.view.*;import android.view.accessibility.*;import java.io.*;

/** External fixture App -> real click event -> focused clipboard read. */
final class CopyPromptSmoke {
    private final Instrumentation test;private final UiAutomation ui;private final Context context;
    CopyPromptSmoke(Instrumentation t){test=t;context=t.getTargetContext();ui=t.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);}
    private void shell(String s)throws Exception{try(ParcelFileDescriptor fd=ui.executeShellCommand(s);InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)){byte[] b=new byte[2048];while(in.read(b)!=-1){}}}
    private AccessibilityNodeInfo find(AccessibilityNodeInfo n,String value){if(n==null)return null;if(value.equals(String.valueOf(n.getText()))||value.equals(String.valueOf(n.getContentDescription())))return n;for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo c=n.getChild(i),hit=find(c,value);if(hit!=null){if(c!=hit)c.recycle();return hit;}if(c!=null)c.recycle();}return null;}
    private AccessibilityNodeInfo node(String value,long timeout)throws Exception{long end=SystemClock.uptimeMillis()+timeout;while(SystemClock.uptimeMillis()<end){for(AccessibilityWindowInfo w:ui.getWindows()){AccessibilityNodeInfo root=w.getRoot(),hit=find(root,value);if(root!=null&&root!=hit)root.recycle();if(hit!=null)return hit;}Thread.sleep(70);}throw new Exception("Missing "+value);}
    private void tap(String value)throws Exception{AccessibilityNodeInfo n=node(value,12000);Rect r=new Rect();n.getBoundsInScreen(r);n.recycle();long time=SystemClock.uptimeMillis();for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent e=MotionEvent.obtain(time,SystemClock.uptimeMillis(),action,r.centerX(),r.centerY(),0);e.setSource(InputDevice.SOURCE_TOUCHSCREEN);ui.injectInputEvent(e,true);e.recycle();Thread.sleep(60);}Thread.sleep(200);}
    private void shot(String name)throws Exception{Thread.sleep(300);Bitmap b=ui.takeScreenshot();try(FileOutputStream out=context.openFileOutput("copy-"+name+".png",0)){b.compress(Bitmap.CompressFormat.PNG,100,out);}b.recycle();}
    private void launch(String target,String args)throws Exception{if(target.startsWith(context.getPackageName()+"/")){context.startActivity(new Intent().setComponent(ComponentName.unflattenFromString(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}else shell("am start -S -W -n "+target+" "+args);Thread.sleep(300);}
    private void check(boolean value,String why){if(!value)throw new AssertionError(why);}
    void run(){Bundle report=new Bundle();try{
        check(Build.FINGERPRINT.contains("generic")||Build.MODEL.contains("sdk"),"Emulator only");
        check(CopyLinkTrigger.label("复制\n链接")&&CopyLinkTrigger.label("Copy link"),"Copy labels");check(!CopyLinkTrigger.label("复制")&&!CopyLinkTrigger.label("复制密码"),"Ignore ordinary Copy");CopyLinkTrigger policy=new CopyLinkTrigger();check(policy.accept(10000,10050)&&!policy.accept(10000,10100)&&!policy.accept(1,15000),"Debounce and stale rejection");
        context.getSharedPreferences("MainActivity",0).edit().putString("origin","http://10.0.2.2:3747").commit();context.getSharedPreferences("CaptureAuthorization",0).edit().putString(android.net.Uri.encode("http://10.0.2.2:3747"),"zn_"+"0".repeat(64)).commit();
        android.accessibilityservice.AccessibilityServiceInfo info=ui.getServiceInfo();info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;ui.setServiceInfo(info);
        ui.setOnAccessibilityEventListener(event->{if(event.getEventType()==AccessibilityEvent.TYPE_VIEW_CLICKED)android.util.Log.i("CopyFixtureEvent","class="+event.getClassName()+" owner="+event.getPackageName()+" labels="+event.getText()+" description="+event.getContentDescription());});
        // A preceding instrumented run can leave the enabled service marked
        // crashed after its process is closed. Rebind this emulator fixture.
        shell("settings delete secure enabled_accessibility_services");Thread.sleep(500);context.getSharedPreferences("CaptureAssist",0).edit().putBoolean("copy_link_prompt",true).putBoolean("capture_bubble",true).commit();shell("settings put secure enabled_accessibility_services io.github.borderarea01.znote/.CaptureAssistService");shell("settings put secure accessibility_enabled 1");Thread.sleep(1200);
        launch("com.xingin.xhs/io.github.borderarea01.capturefixture.PageActivity","--ez menuOpen true --ez copyOnly true");tap("复制\n链接");node("保存到知识库",12000).recycle();node("分享作品 https://xhslink.cn/a/fixture-note，复制本条信息打开 App",12000).recycle();shot("ready");
        node("保存到知识库",3000).recycle();tap("收起采集面板");
        launch("io.github.borderarea01.znote/.CaptureAssistActivity","");
        // Scroll only the settings sheet until its optional controls are visible.
        for(int i=0;i<6;i++){try{AccessibilityNodeInfo n=node("复制链接后打开保存面板",200);Rect bounds=new Rect();n.getBoundsInScreen(bounds);n.recycle();if(bounds.top>0&&bounds.bottom<context.getResources().getDisplayMetrics().heightPixels)break;}catch(Exception ignored){}shell("input swipe 250 650 250 230 250");}
        tap("复制链接后打开保存面板");
        launch("com.xingin.xhs/io.github.borderarea01.capturefixture.PageActivity","--ez menuOpen true --ez copyOnly true");tap("复制\n链接");Thread.sleep(1200);boolean opened=true;try{node("保存到知识库",300).recycle();}catch(Exception expected){opened=false;}check(!opened,"Disabled prompt still opened");shot("disabled");
        launch("io.github.borderarea01.znote/.PixivLoginActivity","");node("Pixiv 登录",4000).recycle();node("完成登录",4000).recycle();shot("pixiv-login");tap("取消");
        report.putString("stream","\nZNOTE_COPY_PROMPT_PASS: external copy, filled link, confirmation, close, disabled and native Pixiv login entry\n");test.finish(Activity.RESULT_OK,report);
    }catch(Throwable e){try{shot("failure");}catch(Exception ignored){}report.putString("stream","\nZNOTE_COPY_PROMPT_FAIL: "+e+"\n");test.finish(Activity.RESULT_CANCELED,report);}}
}
