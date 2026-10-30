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
        CaptureVisuals.SUCCESS=glitch&&!dark?0xff326d54:0xff9bbcae;CaptureVisuals.WARNING=glitch&&!dark?0xff945b24:0xffd3b185;CaptureVisuals.INK=NativeUi.TEXT;CaptureVisuals.MUTED=NativeUi.MUTED;CaptureVisuals.ACCENT=NativeUi.ACCENT;CaptureVisuals.SURFACE=NativeUi.SURFACE;CaptureVisuals.FIELD=glitch?(dark?0xff203146:0xffe6edf5):0xff2a3446;CaptureVisuals.PRIMARY=glitch?0xff1859a8:0xff7689d8;CaptureVisuals.BORDER=glitch?(dark?0xff405872:0xffbdccdd):0xff424e63;
    }
    static synchronized Bundle save(Context c,String json){try{JSONObject v=new JSONObject(json);String s=v.getString("style"),m=v.getString("mode");if(!validStyle(s)||!validMode(m))throw new IOException("外观选项无效");load(c);if(configured&&s.equals(style)&&m.equals(mode)){Bundle b=new Bundle();b.putString("appearance",snapshot());return b;}
        String clean=new JSONObject().put("style",s).put("mode",m).toString();AtomicFile storage=file(c);FileOutputStream out=storage.startWrite();try{out.write(clean.getBytes(java.nio.charset.StandardCharsets.UTF_8));storage.finishWrite(out);}catch(Exception e){storage.failWrite(out);throw e;}configured=true;apply(c,s,m);launcher(c);c.sendBroadcast(new Intent(ACTION).setPackage(c.getPackageName()).putExtra("style",style).putExtra("mode",mode),c.getPackageName()+".permission.APPEARANCE");Bundle b=new Bundle();b.putString("appearance",snapshot());return b;
    }catch(Exception e){throw new IllegalArgumentException("外观未保存，请重试",e);}}
    private static void launcher(Context c){PackageManager pm=c.getPackageManager();ComponentName classic=new ComponentName(c,c.getPackageName()+".LauncherClassic"),alternate=new ComponentName(c,c.getPackageName()+".LauncherGlitch");ComponentName enabled=glitch?alternate:classic,disabled=glitch?classic:alternate;try{if(Build.VERSION.SDK_INT>=33)pm.setComponentEnabledSettings(java.util.Arrays.asList(new PackageManager.ComponentEnabledSetting(enabled,PackageManager.COMPONENT_ENABLED_STATE_ENABLED,PackageManager.DONT_KILL_APP),new PackageManager.ComponentEnabledSetting(disabled,PackageManager.COMPONENT_ENABLED_STATE_DISABLED,PackageManager.DONT_KILL_APP)));else{pm.setComponentEnabledSetting(enabled,PackageManager.COMPONENT_ENABLED_STATE_ENABLED,PackageManager.DONT_KILL_APP);pm.setComponentEnabledSetting(disabled,PackageManager.COMPONENT_ENABLED_STATE_DISABLED,PackageManager.DONT_KILL_APP);}}catch(RuntimeException ignored){/* The in-app icon still changes if a launcher caches its shortcut. */}}
    static void choose(Activity a,Runnable changed){load(a);String[] labels={"经典","建筑故障"};int current=glitch?1:0;new AlertDialog.Builder(a).setTitle("界面与图标").setSingleChoiceItems(labels,current,(d,which)->{d.dismiss();String next=which==1?"glitch":"minimal";new AlertDialog.Builder(a).setTitle("明暗模式").setSingleChoiceItems(new String[]{"跟随系统","浅色","夜间"},"system".equals(mode)?0:"light".equals(mode)?1:2,(dialog,i)->{dialog.dismiss();String selected=i==0?"system":i==1?"light":"dark";java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();worker.execute(()->{try{Bundle result=a.getContentResolver().call(android.net.Uri.parse("content://"+a.getPackageName()+".capture-session"),"appearance",new JSONObject().put("style",next).put("mode",selected).toString(),null);a.runOnUiThread(()->{if(!a.isFinishing()){apply(a,next,selected);changed.run();}});}catch(Exception e){a.runOnUiThread(()->Toast.makeText(a,"外观未保存，请重试",Toast.LENGTH_LONG).show());}finally{worker.shutdown();}});}).setNegativeButton("取消",null).show();}).setNegativeButton("取消",null).show();}
    static Drawable panel(Context c,int radius){return glitch?new Panel(c,radius):NativeUi.shape(c,CaptureVisuals.SURFACE,radius);}
    static Drawable control(Context c,int color,int radius){return glitch&&Color.alpha(color)>0?new Control(c,color,radius):NativeUi.shape(c,color,radius);}
    /** A static material silhouette. Paths are rebuilt only when bounds change;
     * labels, touch targets and user media are never copied or displaced. */
    private static Bitmap photo;
    private static Bitmap photo(Context c){if(photo==null)photo=BitmapFactory.decodeResource(c.getResources(),R.drawable.glitch_architecture);return photo;}
    static final class Frame {
        final Path body=new Path(),grain=new Path();
        void bounds(Rect b,float d,float radius,boolean compact){
            body.reset();grain.reset();java.util.Random left=new java.util.Random(compact?73:34),right=new java.util.Random(compact?29:81);
            float edge=(compact?7:13)*d,r=Math.min(radius,Math.min(b.width(),b.height())/2f);
            for(float y=b.top;y<b.bottom;){float h=Math.min(b.bottom-y,(.55f+left.nextFloat()*(compact?1.3f:2.1f))*d),t=(y-b.top)/Math.max(1,b.height());
                float burst=(float)Math.pow(Math.sin(t*Math.PI*3.4+34),6),a=Math.max(0,edge*(.34f+(left.nextFloat()-.5f)*(.25f+burst*.85f))),z=Math.max(0,edge*(.34f+(right.nextFloat()-.5f)*(.25f+burst*.85f)));
                float near=Math.min(y-b.top,b.bottom-y-h),corner=near<r?r-(float)Math.sqrt(Math.max(0,r*r-(r-near)*(r-near))):0;
                body.addRect(b.left+Math.max(corner,a),y,b.right-Math.max(corner,z),y+h,Path.Direction.CW);
                if(left.nextFloat()<.25f+burst*.65f)grain.addRect(b.left+a,y,b.left+Math.min(edge,a+(2+left.nextFloat()*5)*d),y+Math.min(h,d),Path.Direction.CW);
                if(right.nextFloat()<.25f+burst*.65f)grain.addRect(b.right-Math.min(edge,z+(2+right.nextFloat()*5)*d),y,b.right-z,y+Math.min(h,d),Path.Direction.CW);
                y+=h;
            }
        }
        void material(Canvas c,Paint p,Bitmap bitmap,Rect b,boolean dim){if(bitmap==null)return;c.save();c.clipPath(body);c.clipPath(grain);p.setAlpha(dim?150:220);c.drawBitmap(bitmap,null,new RectF(b),p);p.setAlpha(255);c.restore();}
    }
    static final class Control extends Drawable {
        final Paint paint=new Paint(3);final Frame frame=new Frame();final float density,radius;final int color;final Bitmap image;
        Control(Context c,int color,int radius){density=c.getResources().getDisplayMetrics().density;this.color=color;this.radius=radius*density;image=photo(c);}
        @Override protected void onBoundsChange(Rect b){frame.bounds(b,density,radius,true);}
        @Override public void draw(Canvas c){paint.setColor(color);c.drawPath(frame.body,paint);frame.material(c,paint,image,getBounds(),dark);}
        @Override public void setAlpha(int value){}@Override public void setColorFilter(ColorFilter value){}@Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    }
    static final class Panel extends Drawable {
        final Paint paint=new Paint(3);final Frame frame=new Frame();final float density,radius;final Bitmap image;
        Panel(Context c,int radius){density=c.getResources().getDisplayMetrics().density;this.radius=radius*density;image=photo(c);}
        @Override protected void onBoundsChange(Rect b){frame.bounds(b,density,radius,false);}
        @Override public void draw(Canvas c){Rect b=getBounds();paint.setColor(NativeUi.SURFACE);c.drawPath(frame.body,paint);
            if(image!=null){c.save();c.clipPath(frame.body);float h=Math.min(64*density,b.height());int crop=Math.min(image.getHeight(),Math.round(image.getWidth()*h/Math.max(1,b.width())));paint.setAlpha(dark?56:44);c.drawBitmap(image,new Rect(0,(image.getHeight()-crop)/2,image.getWidth(),(image.getHeight()+crop)/2),new RectF(b.left,b.top,b.right,b.top+h),paint);paint.setAlpha(255);c.restore();}
            frame.material(c,paint,image,b,dark);
        }
        @Override public void setAlpha(int a){}@Override public void setColorFilter(ColorFilter f){}@Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    }
}
