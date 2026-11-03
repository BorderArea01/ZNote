package io.github.borderarea01.znote;

import android.app.*;import android.content.*;import android.content.pm.PackageManager;import android.graphics.*;import android.graphics.drawable.Drawable;import android.os.*;import android.util.AtomicFile;import android.view.*;import android.widget.*;import org.json.*;import java.io.*;

/** Main provider is the sole writer. The capture process reads a tiny local
 * snapshot at creation, and receives in-app updates; no WebView/network wake. */
final class NativeAppearance {
    static final String ACTION="io.github.borderarea01.znote.APPEARANCE_CHANGED";
    static String style="minimal",mode="system";static boolean glitch,dark=true,configured;
    private static AtomicFile file(Context c){return new AtomicFile(new File(c.getFilesDir(),"appearance.json"));}
    static boolean validStyle(String value){return java.util.Arrays.asList("minimal","glass","cyber","paper","glitch").contains(value);}
    static boolean validMode(String value){return java.util.Arrays.asList("light","dark","system").contains(value);}
    static void window(Activity a){a.getWindow().setStatusBarColor(NativeUi.BG);a.getWindow().setNavigationBarColor(NativeUi.BG);View decor=a.getWindow().getDecorView();int mask=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;decor.setSystemUiVisibility(!glitch||dark?decor.getSystemUiVisibility()&~mask:decor.getSystemUiVisibility()|mask);}
    // Before API33 a signature permission restricts this receiver to our UID.
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    static void register(Context c,BroadcastReceiver receiver){IntentFilter filter=new IntentFilter(ACTION);if(Build.VERSION.SDK_INT>=33)c.registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);else c.registerReceiver(receiver,filter,c.getPackageName()+".permission.APPEARANCE",null);}
    static String snapshot(){if(!configured)return "{}";try{return new JSONObject().put("style",style).put("mode",mode).toString();}catch(Exception e){return "{}";}}
    static void load(Context c){try{byte[] bytes=file(c).readFully();if(bytes.length<=1024){JSONObject v=new JSONObject(new String(bytes,java.nio.charset.StandardCharsets.UTF_8));configured=true;apply(c,v.optString("style"),v.optString("mode"));return;}}catch(Exception ignored){}apply(c,style,mode);}
    static void apply(Context c,String next,String nextMode){if(!validStyle(next)||!validMode(nextMode))return;style=next;mode=nextMode;glitch="glitch".equals(style);dark=!"light".equals(mode)&&(!"system".equals(mode)||(c.getResources().getConfiguration().uiMode&48)==32);
        NativeUi.BG=glitch?(dark?0xff111b29:0xffedf2f7):0xff141720;NativeUi.SURFACE=glitch?(dark?0xff192738:0xfffcfdff):0xff202532;NativeUi.TEXT=glitch?(dark?0xffe9f0f8:0xff192d45):0xffedf0f8;NativeUi.MUTED=glitch?(dark?0xffafc1d6:0xff4c6179):0xffa5afc5;NativeUi.ACCENT=glitch?(dark?0xff9bc9ff:0xff1859a8):0xff737fed;
        CaptureVisuals.SUCCESS=glitch&&!dark?0xff315f92:0xffa6bfdc;CaptureVisuals.WARNING=glitch&&!dark?0xff945b24:0xffd3b185;CaptureVisuals.INK=NativeUi.TEXT;CaptureVisuals.MUTED=NativeUi.MUTED;CaptureVisuals.ACCENT=NativeUi.ACCENT;CaptureVisuals.SURFACE=NativeUi.SURFACE;CaptureVisuals.FIELD=glitch?(dark?0xff203146:0xffe6edf5):0xff2a3446;CaptureVisuals.PRIMARY=glitch?0xff1859a8:0xff7689d8;CaptureVisuals.BORDER=glitch?(dark?0xff405872:0xffbdccdd):0xff424e63;
    }
    static synchronized Bundle save(Context c,String json){try{JSONObject v=new JSONObject(json);String s=v.getString("style"),m=v.getString("mode");if(!validStyle(s)||!validMode(m))throw new IOException("外观选项无效");load(c);if(configured&&s.equals(style)&&m.equals(mode)){Bundle b=new Bundle();b.putString("appearance",snapshot());return b;}
        String clean=new JSONObject().put("style",s).put("mode",m).toString();AtomicFile storage=file(c);FileOutputStream out=storage.startWrite();try{out.write(clean.getBytes(java.nio.charset.StandardCharsets.UTF_8));storage.finishWrite(out);}catch(Exception e){storage.failWrite(out);throw e;}configured=true;apply(c,s,m);launcher(c);c.sendBroadcast(new Intent(ACTION).setPackage(c.getPackageName()).putExtra("style",style).putExtra("mode",mode),c.getPackageName()+".permission.APPEARANCE");Bundle b=new Bundle();b.putString("appearance",snapshot());return b;
    }catch(Exception e){throw new IllegalArgumentException("外观未保存，请重试",e);}}
    private static void launcher(Context c){PackageManager pm=c.getPackageManager();ComponentName classic=new ComponentName(c,c.getPackageName()+".LauncherClassic"),alternate=new ComponentName(c,c.getPackageName()+".LauncherGlitch");ComponentName enabled=glitch?alternate:classic,disabled=glitch?classic:alternate;try{if(Build.VERSION.SDK_INT>=33)pm.setComponentEnabledSettings(java.util.Arrays.asList(new PackageManager.ComponentEnabledSetting(enabled,PackageManager.COMPONENT_ENABLED_STATE_ENABLED,PackageManager.DONT_KILL_APP),new PackageManager.ComponentEnabledSetting(disabled,PackageManager.COMPONENT_ENABLED_STATE_DISABLED,PackageManager.DONT_KILL_APP)));else{pm.setComponentEnabledSetting(enabled,PackageManager.COMPONENT_ENABLED_STATE_ENABLED,PackageManager.DONT_KILL_APP);pm.setComponentEnabledSetting(disabled,PackageManager.COMPONENT_ENABLED_STATE_DISABLED,PackageManager.DONT_KILL_APP);}}catch(RuntimeException ignored){/* The in-app icon still changes if a launcher caches its shortcut. */}}
    static void choose(Activity a,Runnable changed){load(a);String[] labels={"经典","建筑故障"};int current=glitch?1:0;new AlertDialog.Builder(a).setTitle("界面外观").setSingleChoiceItems(labels,current,(d,which)->{d.dismiss();String next=which==1?"glitch":"minimal";new AlertDialog.Builder(a).setTitle("明暗模式").setSingleChoiceItems(new String[]{"跟随系统","浅色","夜间"},"system".equals(mode)?0:"light".equals(mode)?1:2,(dialog,i)->{dialog.dismiss();String selected=i==0?"system":i==1?"light":"dark";java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();worker.execute(()->{try{Bundle result=a.getContentResolver().call(android.net.Uri.parse("content://"+a.getPackageName()+".capture-session"),"appearance",new JSONObject().put("style",next).put("mode",selected).toString(),null);a.runOnUiThread(()->{if(!a.isFinishing()){apply(a,next,selected);changed.run();}});}catch(Exception e){a.runOnUiThread(()->Toast.makeText(a,"外观未保存，请重试",Toast.LENGTH_LONG).show());}finally{worker.shutdown();}});}).setNegativeButton("取消",null).show();}).setNegativeButton("取消",null).show();}
    /** Capture has its own quiet dark surface; the library theme and logo stay selected. */
    static void capturePalette(){
        NativeUi.BG=0xff15181e;NativeUi.SURFACE=0xff20242c;NativeUi.TEXT=0xffeef1f6;NativeUi.MUTED=0xffa8b0bf;NativeUi.ACCENT=0xffa8bcf5;
        CaptureVisuals.INK=NativeUi.TEXT;CaptureVisuals.MUTED=NativeUi.MUTED;CaptureVisuals.ACCENT=NativeUi.ACCENT;
        CaptureVisuals.SURFACE=NativeUi.SURFACE;CaptureVisuals.FIELD=0xff2b303a;CaptureVisuals.PRIMARY=0xff526bb0;CaptureVisuals.BORDER=0xff3c424e;
        CaptureVisuals.SUCCESS=0xffa6bfdc;CaptureVisuals.WARNING=0xffd3b185;
    }
    static void loadCapture(Context c){load(c);capturePalette();}
    static Drawable panel(Context c,int radius){android.graphics.drawable.GradientDrawable d=NativeUi.shape(c,CaptureVisuals.SURFACE,radius);d.setStroke(NativeUi.dp(c,1),CaptureVisuals.BORDER);return d;}
    static Drawable control(Context c,int color,int radius){return NativeUi.shape(c,color,radius);}
    /** Retained geometry utility for photo consumers: uniform cover, never stretch. */
    static RectF photoBounds(int width,int height,RectF target){float scale=Math.max(target.width()/Math.max(1,width),target.height()/Math.max(1,height));float w=width*scale,h=height*scale;return new RectF(target.centerX()-w/2,target.centerY()-h/2,target.centerX()+w/2,target.centerY()+h/2);}
}
