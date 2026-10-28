package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.os.*;
import android.view.*;
import android.view.accessibility.*;
import java.io.*;
import java.util.*;

/** Real accessibility windows and touch events in a disposable emulator only. */
final class OverlaySmoke {
    private final Instrumentation test;private final UiAutomation ui;private final Context context;
    OverlaySmoke(Instrumentation test){this.test=test;context=test.getTargetContext();ui=test.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);}
    private void shell(String value)throws Exception{try(ParcelFileDescriptor fd=ui.executeShellCommand(value);InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)){byte[] block=new byte[2048];while(in.read(block)!=-1){/* drain command output on Android 10/11 too */}}}
    private AccessibilityNodeInfo find(AccessibilityNodeInfo root,String value){
        if(root==null)return null;String text=String.valueOf(root.getText()),desc=String.valueOf(root.getContentDescription());
        if(text.equals(value)||desc.contains(value))return AccessibilityNodeInfo.obtain(root);
        for(int i=0;i<root.getChildCount();i++){AccessibilityNodeInfo child=root.getChild(i);if(child==null)continue;AccessibilityNodeInfo found=find(child,value);child.recycle();if(found!=null)return found;}return null;
    }
    private AccessibilityNodeInfo node(String value,int type)throws Exception{
        long until=SystemClock.uptimeMillis()+16000;
        while(SystemClock.uptimeMillis()<until){for(AccessibilityWindowInfo window:ui.getWindows()){if(type!=0&&window.getType()!=type)continue;AccessibilityNodeInfo root=window.getRoot();if(root==null)continue;AccessibilityNodeInfo found=find(root,value);root.recycle();if(found!=null)return found;}Thread.sleep(70);}throw new Exception("Missing UI: "+value);
    }
    private Rect bounds(String value)throws Exception{AccessibilityNodeInfo n=node(value,AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY);Rect r=new Rect();n.getBoundsInScreen(r);n.recycle();return r;}
    private void event(long down,int action,float x,float y)throws Exception{MotionEvent e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x,y,0);e.setSource(InputDevice.SOURCE_TOUCHSCREEN);if(!ui.injectInputEvent(e,true))throw new Exception("Touch not delivered");e.recycle();}
    private void tap(String value,int type)throws Exception{AccessibilityNodeInfo n=node(value,type);long until=SystemClock.uptimeMillis()+12000;while(!n.isEnabled()&&SystemClock.uptimeMillis()<until){n.recycle();Thread.sleep(100);n=node(value,type);}check(n.isEnabled(),"Control never enabled: "+value);Rect r=new Rect();n.getBoundsInScreen(r);n.recycle();long t=SystemClock.uptimeMillis();event(t,MotionEvent.ACTION_DOWN,r.centerX(),r.centerY());Thread.sleep(45);event(t,MotionEvent.ACTION_UP,r.centerX(),r.centerY());Thread.sleep(200);}
    private void tap(String value)throws Exception{tap(value,AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY);}
    private void shot(String name)throws Exception{Thread.sleep(350);Bitmap b=ui.takeScreenshot();if(b==null)throw new Exception("No screenshot");try(FileOutputStream out=context.openFileOutput("overlay-"+name+".png",0)){b.compress(Bitmap.CompressFormat.PNG,100,out);}b.recycle();}
    private void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
    private void pinnedControls(boolean keyboard)throws Exception{
        Rect close=new Rect(),save=new Rect();AccessibilityNodeInfo n=node("收起采集面板",1);n.getBoundsInScreen(close);n.recycle();n=node("保存到知识库",1);n.getBoundsInScreen(save);n.recycle();
        int bottom=context.getResources().getDisplayMetrics().heightPixels;boolean ime=false;
        for(AccessibilityWindowInfo w:ui.getWindows())if(w.getType()==AccessibilityWindowInfo.TYPE_INPUT_METHOD){Rect r=new Rect();w.getBoundsInScreen(r);if(!r.isEmpty()){bottom=Math.min(bottom,r.top);ime=true;}}
        check(!keyboard||ime,"Keyboard scenario did not actually show IME");check(close.top>=0&&close.bottom<=bottom,"Close hidden behind keyboard/screen");check(save.top>=close.bottom&&save.bottom<=bottom,"Save hidden behind keyboard/screen");
        if(keyboard){n=node("摄影参考",1);Rect library=new Rect();n.getBoundsInScreen(library);n.recycle();check(library.top>=close.bottom&&library.bottom<=save.top,"Selected library needs scrolling while typing");}
    }
    void run()throws Exception{
        Bundle report=new Bundle();try{
            if(!Build.FINGERPRINT.contains("generic")&&!Build.MODEL.contains("sdk"))throw new Exception("This test is emulator-only");
            final String origin="http://10.0.2.2:3747";
            context.getSharedPreferences("MainActivity",0).edit().putString("origin",origin).commit();context.getSharedPreferences("CaptureAuthorization",0).edit().putString(android.net.Uri.encode(origin),"zn_"+"0".repeat(64)).commit();
            android.accessibilityservice.AccessibilityServiceInfo info=ui.getServiceInfo();info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;ui.setServiceInfo(info);
            shell("settings put secure enabled_accessibility_services io.github.borderarea01.znote/.CaptureAssistService");shell("settings put secure accessibility_enabled 1");shell("input keyevent 3");
            float density=context.getResources().getDisplayMetrics().density;Rect docked=bounds("贴边页签");check(Math.abs(docked.width()/density-24)<2,"Docked hit area too wide");shot("docked");
            tap("贴边页签");Rect card=bounds("ZNote 采集面板");check(card.width()/density<280,"Card width exceeds A proposal");node("采集当前作品",4).recycle();node("前往知识库",4).recycle();shot("expanded");Bundle geometry=new Bundle();geometry.putString("stream","\nOverlay geometry: display="+context.getResources().getDisplayMetrics().widthPixels+" header="+card+" density="+density+"\n");test.sendStatus(0,geometry);
            tap("当前知识库：");tap("摄影参考");tap("ZNote 采集面板");
            // A 6 dp move must detach immediately, without a long press or the
            // old full-panel render; 2 dp of tap jitter must still open it.
            Rect small=bounds("贴边页签");long smallTime=SystemClock.uptimeMillis();event(smallTime,0,small.centerX(),small.centerY());event(smallTime,2,small.centerX()-6*density,small.centerY());Rect responsive=bounds("完整页签按钮");long observed=SystemClock.uptimeMillis()-smallTime;check(Math.abs(responsive.width()/density-48)<2,"Small drag did not detach");Bundle latency=new Bundle();latency.putString("stream","\nSmall drag observed in "+observed+" ms (isolated emulator)\n");test.sendStatus(0,latency);event(smallTime,3,small.centerX()-6*density,small.centerY());Thread.sleep(250);
            Rect start=bounds("贴边页签");int screenWidth=context.getResources().getDisplayMetrics().widthPixels;long time=SystemClock.uptimeMillis();event(time,0,start.centerX(),start.centerY());event(time,2,screenWidth*.45f,start.centerY()+80);Thread.sleep(180);Rect free=bounds("完整页签按钮");check(Math.abs(free.width()/density-48)<2,"Dragging must restore a full-sized button");shot("dragging");event(time,1,screenWidth*.45f,start.centerY()+80);Thread.sleep(300);Rect left=bounds("贴边页签");check(left.left<3,"Release did not snap left");
            time=SystemClock.uptimeMillis();event(time,0,left.centerX(),left.centerY());event(time,2,screenWidth*.7f,left.centerY());Thread.sleep(80);event(time,3,screenWidth*.7f,left.centerY());Thread.sleep(300);Rect right=bounds("贴边页签");check(right.right>=screenWidth-3,"Cancelled drag must remain usable");
            Rect jitter=bounds("贴边页签");time=SystemClock.uptimeMillis();event(time,0,jitter.centerX(),jitter.centerY());event(time,2,jitter.centerX()-2*density,jitter.centerY());event(time,1,jitter.centerX()-2*density,jitter.centerY());node("采集当前作品",4).recycle();tap("粘贴链接");AccessibilityNodeInfo edit=node("作品链接或分享文案",1);check(edit.isEditable()&&edit.isLongClickable(),"Native editing/long-press lost");shot("capture-empty");
            // Selector cancellation, empty input validation, help, and close
            // must leave a usable capture window and the remembered library.
            tap("摄影参考",1);node("摄影参考",1).recycle();shot("capture-libraries");shell("input keyevent 4");tap("保存到知识库",1);node("请粘贴一个作品链接",1).recycle();tap("手机采集说明",1);node("知道了",1).recycle();tap("知道了",1);tap("收起采集面板",1);tap("贴边页签");tap("粘贴链接");edit.recycle();edit=node("作品链接或分享文案",1);
            Bundle value=new Bundle();value.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"https://example.com/success");check(edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,value),"Cannot edit share text");edit.recycle();shot("capture-ready");tap("保存到知识库",1);
            node("正在后台采集",4).recycle();shot("working");node("已保存到 ZNote",4).recycle();shot("success");Thread.sleep(2600);
            // The large result hint expires; the small bookmark retains its result.
            int overlays=0;for(AccessibilityWindowInfo w:ui.getWindows())if(w.getType()==4)overlays++;check(overlays==1,"Success hint did not retract");
            tap("ZNote 采集结果");node("采集当前作品",4).recycle();tap("粘贴链接");edit=node("作品链接或分享文案",1);value.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,"https://example.com/failure");edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,value);edit.recycle();tap("保存到知识库",1);node("未保存 · 点击查看",4).recycle();shot("failure");tap("未保存 · 点击查看");node("采集失败：示例连接中断",4).recycle();node("采集当前作品",4).recycle();shot("failure-open");
            tap("ZNote 采集面板");tap("贴边页签");tap("前往知识库");node("贴边页签",4).recycle();shot("browse");
            // Font scale and orientation changes should still leave actions reachable.
            shell("settings put system font_scale 1.3");Thread.sleep(400);tap("贴边页签");node("前往知识库",4).recycle();shot("large-font");tap("粘贴链接");node("保存到知识库",1).recycle();node("打开 ZNote 浏览知识库",1).recycle();shot("capture-large-font");
            node("摄影参考",1).recycle();shell("settings put secure show_ime_with_hard_keyboard 1");tap("作品链接或分享文案",1);Thread.sleep(700);pinnedControls(true);shot("capture-keyboard");shell("input keyevent 4");tap("收起采集面板",1);
            shell("settings put system accelerometer_rotation 0");shell("settings put system user_rotation 1");Thread.sleep(700);tap("贴边页签");tap("粘贴链接");
            pinnedControls(false);shot("capture-landscape");tap("收起采集面板",1);
            report.putString("stream","\nZNOTE_OVERLAY_SMOKE_PASS\n");test.finish(Activity.RESULT_OK,report);
        }catch(Throwable e){try{shot("failure-diagnostic");}catch(Exception ignored){}report.putString("stream","\nZNOTE_OVERLAY_SMOKE_FAIL: "+e+"\n");test.finish(Activity.RESULT_CANCELED,report);}
    }
}
