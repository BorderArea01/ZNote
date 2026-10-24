package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.view.accessibility.*;
import android.webkit.WebView;
import android.widget.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Disposable LAN + relay endpoints only, on an isolated emulator. */
final class RouteSmoke {
    final Instrumentation test;
    final String lan="http://10.0.2.2:3842",remote="http://10.0.2.2:3843";
    RouteSmoke(Instrumentation test){this.test=test;}
    Context context(){return test.getTargetContext();}
    void check(boolean condition,String message)throws Exception{if(!condition)throw new Exception(message);}
    JSONObject control(String mode)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(lan+"/test/control?mode="+mode).openConnection();c.setConnectTimeout(2000);c.setReadTimeout(3000);
        try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] block=new byte[1024];int n;while((n=in.read(block))!=-1)out.write(block,0,n);return new JSONObject(out.toString("UTF-8"));}finally{c.disconnect();}
    }
    Bundle session(String pin,boolean localOnly){Bundle extras=new Bundle();extras.putBoolean("local_only",localOnly);return context().getContentResolver().call(Uri.parse("content://"+context().getPackageName()+".capture-session"),"session",pin,extras);}
    String tree(AccessibilityNodeInfo node){if(node==null)return "";StringBuilder s=new StringBuilder();if(node.getText()!=null)s.append(node.getText()).append(" | ");if(node.getContentDescription()!=null)s.append(node.getContentDescription()).append(" | ");for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);s.append(tree(child));if(child!=null)child.recycle();}return s.toString();}
    UiAutomation ui(){return test.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);}
    void until(String text)throws Exception{long end=SystemClock.uptimeMillis()+15000;String last="";while(SystemClock.uptimeMillis()<end){AccessibilityNodeInfo root=ui().getRootInActiveWindow();last=tree(root);if(root!=null)root.recycle();if(last.contains(text))return;Thread.sleep(150);}throw new Exception("Missing "+text+": "+last);}
    void touch(String text)throws Exception{until(text);AccessibilityNodeInfo root=ui().getRootInActiveWindow();try{for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(text)){if(text.contentEquals(node.getText()==null?"":node.getText())||text.contentEquals(node.getContentDescription()==null?"":node.getContentDescription())){android.graphics.Rect r=new android.graphics.Rect();node.getBoundsInScreen(r);long now=SystemClock.uptimeMillis();MotionEvent a=MotionEvent.obtain(now,now,MotionEvent.ACTION_DOWN,r.centerX(),r.centerY(),0),b=MotionEvent.obtain(now,now+80,MotionEvent.ACTION_UP,r.centerX(),r.centerY(),0);a.setSource(InputDevice.SOURCE_TOUCHSCREEN);b.setSource(InputDevice.SOURCE_TOUCHSCREEN);ui().injectInputEvent(a,true);ui().injectInputEvent(b,true);a.recycle();b.recycle();node.recycle();return;}node.recycle();}}finally{root.recycle();}throw new Exception("Untouchable "+text);}
    View find(View view,Class<?> kind){if(kind.isInstance(view))return view;if(view instanceof android.view.ViewGroup){android.view.ViewGroup g=(android.view.ViewGroup)view;for(int i=0;i<g.getChildCount();i++){View result=find(g.getChildAt(i),kind);if(result!=null)return result;}}return null;}
    void checkpoint(String text){Bundle b=new Bundle();b.putString("stream","\n"+text+"\n");test.sendStatus(0,b);}
    void share(String text)throws Exception{
        context().startActivity(new Intent(context(),ShareActivity.class).setAction(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,text).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        until("已连接");touch("保存到知识库");until("已入库");touch("收起采集面板");Thread.sleep(300);
    }
    void run(){Bundle result=new Bundle();try{
        check(ConnectionRoutes.local("http://192.168.20.99:3741"),"Private IPv4 rejected");check(ConnectionRoutes.local("http://[fd00::1]:3741"),"Private IPv6 rejected");check(!ConnectionRoutes.local("https://192.168.example.com"),"Public host treated as LAN");check(!ConnectionRoutes.local("https://10.attacker.com"),"Public prefix treated as LAN");
        check("https://library.example.com".equals(ConnectionRoutes.choose("https://library.example.com",lan,remote,true,value->false)),"Explicit full server file uploads regressed");
        context().getSharedPreferences("MainActivity",0).edit().clear().putString("origin",remote).putString("remote_capture_origin",remote).putString("previous_origin",lan).commit();
        context().getSharedPreferences("CaptureSharing",0).edit().clear().commit();
        context().getSharedPreferences("CaptureAuthorization",0).edit().putString(Uri.encode(lan),"zn_"+"a".repeat(64)).putString(Uri.encode(remote),"zn_"+"b".repeat(64)).commit();
        // Give the isolated guest's first WebView/provider startup a chance to
        // settle before measuring normal route selection and request counts.
        control("online");session(lan,false);Bundle chosen=session(null,false);check(lan.equals(chosen.getString("origin")),"LAN not prioritized");check("lan".equals(chosen.getString("route")),"LAN label missing");check(("zn_"+"a".repeat(64)).equals(chosen.getString("token")),"Wrong LAN credential");check(control("stats").getInt("remoteRequests")==0,"LAN selection contacted relay");
        checkpoint("Saved beta.22 previous_origin migrated: authorized LAN chosen, zero relay requests");
        MainActivity activity=(MainActivity)test.startActivitySync(new Intent(context(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        test.runOnMainSync(()->WebView.setWebContentsDebuggingEnabled(true));
        test.runOnMainSync(()->{View root=activity.getWindow().getDecorView();((EditText)find(root,EditText.class)).setText(remote);});touch("连接并打开");until("ZNote · 局域网直连");
        final String[] url={""};test.runOnMainSync(()->url[0]=((WebView)find(activity.getWindow().getDecorView(),WebView.class)).getUrl());check(url[0].startsWith(lan),"Main library still opened relay");Bundle legacy=new Bundle();legacy.putBoolean("legacy_job",true);check(remote.equals(context().getContentResolver().call(Uri.parse("content://"+context().getPackageName()+".capture-session"),"session",null,legacy).getString("origin")),"Pre-upgrade jobs lost their remote origin");
        share("https://example.com/lan-test");check(control("stats").getInt("localSubmissions")==1,"LAN share not submitted");check(control("stats").getInt("remoteRequests")==0,"LAN capture contacted relay");
        checkpoint("Real Android main UI and share UI use LAN; save and completion, zero relay requests");
        control("offline");chosen=session(null,false);check(remote.equals(chosen.getString("origin")),"Unavailable LAN did not fall back");check(("zn_"+"b".repeat(64)).equals(chosen.getString("token")),"Relay did not use its own credential");check(session(null,true).getString("origin").isEmpty(),"File upload routed to relay");check(lan.equals(session(lan,false).getString("origin")),"Pinned LAN job was rerouted");
        share("https://example.com/remote-test");check(control("stats").getInt("remoteSubmissions")==1,"Fallback share not submitted");
        checkpoint("LAN unavailable: links use remote, files stay local-only, submitted jobs keep their original origin");
        control("online");check(lan.equals(session(null,false).getString("origin")),"LAN recovery was not automatic");check(remote.equals(session(remote,false).getString("origin")),"Pinned remote job switched to LAN");
        control("unauthorized");check(remote.equals(session(null,false).getString("origin")),"Unauthorized LAN was selected");
        control("invalid");check(remote.equals(session(null,false).getString("origin")),"Non-ZNote response was selected");
        control("timeout");long began=SystemClock.elapsedRealtime();check(remote.equals(session(null,false).getString("origin")),"Timeout fallback failed");check(SystemClock.elapsedRealtime()-began<2500,"LAN timeout delayed fallback excessively");control("online");
        check(control("stats").getInt("credentialLeaks")==0,"Origin credentials crossed routes");
        try(android.os.ParcelFileDescriptor home=ui().executeShellCommand("input keyevent 3")){Thread.sleep(150);}Thread.sleep(300);context().startActivity(new Intent(context(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));until("ZNote · 局域网直连");until("访问密码 / PIN");Thread.sleep(300);android.graphics.Bitmap screenshot=ui().takeScreenshot();if(screenshot!=null)try(FileOutputStream out=context().openFileOutput("route-smoke.png",0)){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}
        checkpoint("Recovery, invalid response, revoked local auth, bounded timeout and credential isolation passed");result.putString("stream","\nZNOTE_ANDROID_ROUTE_PASS\n");test.finish(Activity.RESULT_OK,result);
    }catch(Throwable e){result.putString("stream","\nZNOTE_ANDROID_ROUTE_FAIL: "+e+"\n");test.finish(Activity.RESULT_CANCELED,result);}}
}
