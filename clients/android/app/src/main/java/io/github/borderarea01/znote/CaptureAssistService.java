package io.github.borderarea01.znote;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.*;
import android.graphics.drawable.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.view.accessibility.*;
import android.widget.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

/** One user-triggered operation at a time. No tree traversal on the UI thread. */
public class CaptureAssistService extends AccessibilityService {
    static CaptureAssistService current; // Settings activity shares only this lightweight process.
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService reader=Executors.newSingleThreadExecutor();
    private WindowManager manager;
    private WindowManager.LayoutParams layout;
    private LinearLayout bubble;
    private TextView status,handle;
    private LinearLayout panel;
    private String panelMessage;
    private boolean panelBusy;
    private final ExecutorService diagnostics=Executors.newSingleThreadExecutor();
    private boolean expanded=false,busy=false;
    private volatile int generation=0;
    private Future<?> operation;
    private final java.util.concurrent.atomic.AtomicBoolean reading=new java.util.concurrent.atomic.AtomicBoolean();
    private String lastMessage="";
    private long tapAt;
    private SharedPreferences prefs(){return getSharedPreferences("CaptureAssist",MODE_PRIVATE);}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(){
        super.onCreate();record("process_start","pid="+android.os.Process.myPid());
        if(Build.VERSION.SDK_INT>=30)diagnostics.execute(()->{try{android.app.ActivityManager am=(android.app.ActivityManager)getSystemService(ACTIVITY_SERVICE);for(android.app.ApplicationExitInfo exit:am.getHistoricalProcessExitReasons(getPackageName(),0,5))if(exit.getProcessName().endsWith(":capture"))writeDiagnostic("previous_exit","time="+exit.getTimestamp()+" reason="+exit.getReason()+" status="+exit.getStatus());}catch(RuntimeException ignored){}});
        // SharedPreferences is not a multi-process store. Migrate only the three
        // capture keys, then leave the main process's connection settings alone.
        if(!prefs().contains("capture_bubble")){SharedPreferences legacy=getSharedPreferences("MainActivity",MODE_PRIVATE);prefs().edit().putBoolean("capture_bubble",legacy.getBoolean("capture_bubble",true)).putBoolean("capture_right",legacy.getBoolean("capture_right",true)).putFloat("capture_y",legacy.getFloat("capture_y",.32f)).apply();}
    }
    @Override protected void onServiceConnected(){current=this;manager=(WindowManager)getSystemService(WINDOW_SERVICE);if(Build.VERSION.SDK_INT>=33)setCacheEnabled(false);android.accessibilityservice.AccessibilityServiceInfo info=getServiceInfo();info.eventTypes=0;setServiceInfo(info);record("connected","ready");if(prefs().getBoolean("capture_bubble",true))showBubble();notifyReady();}
    @Override public void onAccessibilityEvent(AccessibilityEvent event){}
    @Override public void onInterrupt(){cancel();if(bubble!=null)message("采集被系统中断，可重新尝试");}
    @Override public void onDestroy(){hideBubble();record("service_destroy","called");diagnostics.shutdown();reader.shutdownNow();((android.app.NotificationManager)getSystemService(NOTIFICATION_SERVICE)).cancel(3741);if(current==this)current=null;super.onDestroy();}
    @Override public void onConfigurationChanged(Configuration config){super.onConfigurationChanged(config);cancel();expanded=false;render();}
    private void record(String event,String detail){android.util.Log.i("ZNoteCapture",event+" "+detail);if(!diagnostics.isShutdown())diagnostics.execute(()->writeDiagnostic(event,detail));}
    private void writeDiagnostic(String event,String detail){try{java.io.File file=new java.io.File(getFilesDir(),"capture-diagnostics.log");if(file.length()>65536){java.io.File previous=new java.io.File(getFilesDir(),"capture-diagnostics.previous.log");if(previous.exists())previous.delete();file.renameTo(previous);}try(java.io.FileWriter out=new java.io.FileWriter(file,true)){out.write(System.currentTimeMillis()+" pid="+android.os.Process.myPid()+" "+event+" "+detail+"\n");}}catch(java.io.IOException ignored){}}
    private int width(){return getResources().getDisplayMetrics().widthPixels;}
    private int height(){return getResources().getDisplayMetrics().heightPixels;}
    private GradientDrawable shape(int color,int radius){GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(dp(radius));return g;}
    private TextView control(String text,String description,Runnable action){
        TextView b=new TextView(this);b.setText(text);b.setContentDescription(description);b.setTextSize(14);b.setSingleLine(true);b.setEllipsize(android.text.TextUtils.TruncateAt.END);b.setTextColor(0xffecedf5);b.setGravity(Gravity.CENTER);b.setMinHeight(dp(44));b.setPadding(dp(12),dp(8),dp(12),dp(8));b.setFocusable(true);b.setClickable(true);
        b.setBackground(new RippleDrawable(android.content.res.ColorStateList.valueOf(0x336f82ff),shape(0x00202020,10),shape(0xffffffff,10)));b.setOnClickListener(v->{try{action.run();}catch(RuntimeException e){record("control_failed",e.getClass().getSimpleName());Toast.makeText(this,"操作未完成，请重新显示悬浮窗",Toast.LENGTH_LONG).show();}});return b;
    }
    boolean visible(){return bubble!=null;}
    boolean capturing(){return busy;}
    void setVisible(boolean value){prefs().edit().putBoolean("capture_bubble",value).apply();if(value)showBubble();else hideBubble();notifyReady();}
    public void showBubble(){
        if(manager==null)return;
        if(bubble!=null){render();if(bubble!=null)return;}
        if(bubble==null){bubble=new LinearLayout(this);bubble.setOrientation(LinearLayout.VERTICAL);bubble.setElevation(dp(6));layout=new WindowManager.LayoutParams(dp(48),-2,WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT);layout.gravity=Gravity.TOP|Gravity.LEFT;layout.windowAnimations=0;try{manager.addView(bubble,layout);}catch(RuntimeException e){bubble=null;record("attach_failed",e.getClass().getSimpleName());Toast.makeText(this,"悬浮窗未能显示，请重新开启采集辅助",Toast.LENGTH_LONG).show();return;}}
        render();
    }
    public void hideBubble(){cancel();if(bubble!=null){try{manager.removeView(bubble);}catch(IllegalArgumentException ignored){}bubble=null;}panel=null;handle=null;panelMessage=null;expanded=false;}
    // addView registers the window before the first View attachment callback.
    // Updating here must also position that first frame, not wait for a tap.
    private void updateWindow(){if(bubble!=null)try{manager.updateViewLayout(bubble,layout);}catch(RuntimeException e){bubble=null;record("detached",e.getClass().getSimpleName());}}
    private void cancel(){generation++;if(operation!=null)operation.cancel(true);operation=null;busy=false;handler.removeCallbacksAndMessages(null);if(bubble!=null){layout.flags=WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;updateWindow();}}
    private void dock(){
        if(bubble==null)return;int w=expanded?Math.min(dp(228),width()-dp(24)):dp(28);layout.width=w;
        layout.x=prefs().getBoolean("capture_right",true)?Math.max(0,width()-w):0;
        int anchor=Math.round(prefs().getFloat("capture_y",.32f)*Math.max(dp(32),height()-dp(96)));
        bubble.measure(View.MeasureSpec.makeMeasureSpec(w,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(Math.max(dp(48),height()-dp(64)),View.MeasureSpec.AT_MOST));
        layout.y=Math.max(dp(24),Math.min(height()-bubble.getMeasuredHeight()-dp(32),anchor));updateWindow();
    }
    private void render(){
        if(bubble==null)return;
        bubble.setPadding(expanded?dp(8):0,expanded?dp(4):0,expanded?dp(8):0,expanded?dp(8):0);
        GradientDrawable bg=shape(0xff191c27,expanded?18:16);bg.setStroke(dp(1),0xff3c4258);bubble.setBackground(bg);layout.flags=WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
        if(handle==null||handle.getParent()!=bubble){
            bubble.removeAllViews();handle=control("","ZNote 悬浮采集，拖动换位置",()->{long started=tapAt==0?SystemClock.uptimeMillis():tapAt;tapAt=0;expanded=!expanded;record("toggle",expanded?"open":"collapse");render();if(expanded)measureFrame(started);});handle.setPadding(0,dp(8),0,dp(8));handle.setTypeface(null,android.graphics.Typeface.BOLD);bubble.addView(handle);drag(handle);panel=null;
        }
        handle.setText(expanded?"⠿  ZNote":"⋮");handle.setTextSize(expanded?14:19);
        // Prepare once when the service connects; simple open/close reuses the
        // existing views instead of inflating and measuring a fresh control tree.
        if(panel==null||panelBusy!=busy||!java.util.Objects.equals(panelMessage,lastMessage)){
            if(panel!=null)bubble.removeView(panel);panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panelBusy=busy;panelMessage=lastMessage;
            TextView capture=control(busy?"正在识别…":"获取当前页面","获取当前页面",this::capture);capture.setBackground(shape(0xff5968cf,11));capture.setEnabled(!busy);panel.addView(capture);
            if(busy)panel.addView(control("取消识别","取消识别",()->{cancel();message("已取消，可重新采集");}));
            LinearLayout actions=new LinearLayout(this);actions.addView(control("粘贴","粘贴链接",()->open("")),new LinearLayout.LayoutParams(0,-2,1));actions.addView(control("收起","收起悬浮采集",()->{expanded=false;render();}),new LinearLayout.LayoutParams(0,-2,1));actions.addView(control("关闭","关闭悬浮采集",()->{prefs().edit().putBoolean("capture_bubble",false).apply();hideBubble();notifyReady();}),new LinearLayout.LayoutParams(0,-2,1));panel.addView(actions);
            status=new TextView(this);status.setTextColor(0xffbcc3db);status.setTextSize(12);status.setPadding(dp(6),dp(8),dp(6),dp(2));status.setText(lastMessage);status.setVisibility(lastMessage.isEmpty()?View.GONE:View.VISIBLE);status.setMaxLines(4);status.setMovementMethod(android.text.method.ScrollingMovementMethod.getInstance());status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);panel.addView(status);bubble.addView(panel);
        }
        panel.setVisibility(expanded?View.VISIBLE:View.GONE);dock();
    }
    private void drag(View handle){handle.setOnTouchListener(new View.OnTouchListener(){float x,y;int ox,oy;boolean moved;final int slop=ViewConfiguration.get(CaptureAssistService.this).getScaledTouchSlop();public boolean onTouch(View v,MotionEvent e){switch(e.getActionMasked()){
        case MotionEvent.ACTION_DOWN:record("touch_dispatch","delay_ms="+Math.max(0,SystemClock.uptimeMillis()-e.getEventTime()));x=e.getRawX();y=e.getRawY();ox=layout.x;oy=layout.y;moved=false;v.setPressed(true);return true;
        case MotionEvent.ACTION_MOVE:float dx=e.getRawX()-x,dy=e.getRawY()-y;if(Math.hypot(dx,dy)>slop)moved=true;if(moved){v.setPressed(false);layout.x=Math.max(0,Math.min(width()-layout.width,ox+(int)dx));layout.y=Math.max(dp(24),Math.min(height()-bubble.getHeight()-dp(32),oy+(int)dy));updateWindow();}return true;
        case MotionEvent.ACTION_UP:v.setPressed(false);if(!moved){tapAt=e.getEventTime();v.performClick();}else{prefs().edit().putBoolean("capture_right",layout.x+layout.width/2>width()/2).putFloat("capture_y",Math.max(0,Math.min(1,layout.y/(float)Math.max(1,height()-dp(96))))).apply();expanded=false;render();}return true;
        case MotionEvent.ACTION_CANCEL:v.setPressed(false);dock();return true;default:return false;}}});}
    private void measureFrame(long started){
        final View view=bubble;if(view==null)return;
        view.getViewTreeObserver().addOnDrawListener(new android.view.ViewTreeObserver.OnDrawListener(){boolean done;public void onDraw(){if(done)return;done=true;record("panel_frame","ms="+Math.max(0,SystemClock.uptimeMillis()-started));view.post(()->{if(view.getViewTreeObserver().isAlive())view.getViewTreeObserver().removeOnDrawListener(this);});}});view.invalidate();
    }
    private void message(String text){lastMessage=text;busy=false;expanded=true;render();if(status!=null){status.setText(text);status.setVisibility(View.VISIBLE);}}
    private static boolean social(String pkg){return pkg.equals("com.xingin.xhs")||pkg.equals("com.ss.android.ugc.aweme")||pkg.equals("com.ss.android.ugc.aweme.lite")||bilibili(pkg);}
    private static boolean bilibili(String pkg){return Arrays.asList("tv.danmaku.bili","com.bilibili.app.in","com.bilibili.app.blue").contains(pkg);}
    private static boolean browser(String pkg){return Arrays.asList("com.android.chrome","com.chrome.beta","com.microsoft.emmx","org.mozilla.firefox","org.mozilla.fenix","com.sec.android.app.sbrowser","com.heytap.browser","com.vivo.browser","com.UCMobile","com.android.browser","com.huawei.browser","com.mi.globalbrowser","com.brave.browser").contains(pkg);}
    private String pkg(AccessibilityNodeInfo n){return n.getPackageName()==null?"":n.getPackageName().toString();}
    private void check(int token)throws InterruptedException{if(token!=generation||Thread.currentThread().isInterrupted())throw new InterruptedException();}
    private AccessibilityNodeInfo page(String owner){

        for(AccessibilityWindowInfo w:getWindows())if(w.getType()==AccessibilityWindowInfo.TYPE_APPLICATION&&(owner!=null||w.isActive()||w.isFocused())){AccessibilityNodeInfo root=(Build.VERSION.SDK_INT>=33?w.getRoot(0):w.getRoot());if(root!=null){if(owner==null||owner.equals(pkg(root)))return root;root.recycle();}}
        AccessibilityNodeInfo root=(Build.VERSION.SDK_INT>=33?getRootInActiveWindow(0):getRootInActiveWindow());if(root!=null&&owner!=null&&!owner.equals(pkg(root))){root.recycle();return null;}return root;
    }
    private interface Match {boolean test(AccessibilityNodeInfo n);}
    private AccessibilityNodeInfo find(AccessibilityNodeInfo root,Match match,int token)throws InterruptedException{
        if(root==null)return null;ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);long end=SystemClock.uptimeMillis()+1000;int count=0;
        try{while(!queue.isEmpty()&&count++<320&&SystemClock.uptimeMillis()<end){check(token);AccessibilityNodeInfo n=queue.removeFirst();if(n.isVisibleToUser()&&!n.isPassword()&&match.test(n))return n;for(int i=0;i<n.getChildCount()&&queue.size()<320&&SystemClock.uptimeMillis()<end;i++){AccessibilityNodeInfo child=(Build.VERSION.SDK_INT>=33?n.getChild(i,0):n.getChild(i));if(child!=null)queue.add(child);}n.recycle();}return null;}finally{for(AccessibilityNodeInfo n:queue)n.recycle();}
    }
    private static String clean(CharSequence value){return value==null?"":value.toString().replaceAll("[\\s\\u200b-\\u200f\\ufeff]+","").trim();}
    private static boolean semantic(AccessibilityNodeInfo n,boolean copy){
        for(String raw:new String[]{clean(n.getText()),clean(n.getContentDescription())}){String value=raw.replaceAll("[,，。]*(双击即可激活|双击激活|doubletaptoactivate)[。.!！]*$","");if(copy?value.matches("(?i)^(复制(分享)?链接|copylink)[,，·]*(按钮)?$"):value.matches("(?i)^(更多分享|分享|转发|share)((此|该)?(笔记|作品|视频)|按钮|给朋友|给好友)?[,，·]*([0-9.]+[万wWkK]?)?(按钮)?$"))return true;}
        String id=n.getViewIdResourceName();return !copy&&id!=null&&id.toLowerCase(Locale.ROOT).matches(".*:id/(.*_)?(share|share_button|share_icon|btn_share|iv_share)");
    }
    private AccessibilityNodeInfo button(String owner,boolean copy,int token)throws Exception{

        for(AccessibilityWindowInfo w:getWindows())if(w.getType()==AccessibilityWindowInfo.TYPE_APPLICATION){AccessibilityNodeInfo root=(Build.VERSION.SDK_INT>=33?w.getRoot(0):w.getRoot());if(root==null)continue;if(!owner.equals(pkg(root))){root.recycle();continue;}
            // Provider-side text search reaches native dialogs and large lists without walking each row.
            for(String query:copy?new String[]{"复制链接","复制分享链接","Copy link"}:new String[]{"分享","转发","Share"}){check(token);java.util.List<AccessibilityNodeInfo> matches=root.findAccessibilityNodeInfosByText(query);AccessibilityNodeInfo hit=null;Rect first=new Rect();boolean ambiguous=false;for(AccessibilityNodeInfo n:matches){if(n.isVisibleToUser()&&!n.isPassword()&&semantic(n,copy)){Rect bounds=new Rect();n.getBoundsInScreen(bounds);if(hit==null){hit=n;first.set(bounds);continue;}if(!Rect.intersects(first,bounds))ambiguous=true;}n.recycle();}if(hit!=null){root.recycle();if(ambiguous){hit.recycle();throw new Exception("页面有多个分享入口，请先打开要采集的具体作品");}return hit;}}
            AccessibilityNodeInfo found=find(root,n->semantic(n,copy),token);if(found!=null)return found;
        }return null;
    }
    private boolean click(AccessibilityNodeInfo node,int token)throws Exception{
        android.graphics.Rect target=new android.graphics.Rect();node.getBoundsInScreen(target);AccessibilityNodeInfo n=node;
        for(int i=0;n!=null&&i<7;i++){check(token);if(n.isClickable()&&n.isEnabled()&&n.performAction(AccessibilityNodeInfo.ACTION_CLICK)){n.recycle();return true;}AccessibilityNodeInfo p=(Build.VERSION.SDK_INT>=33?n.getParent(0):n.getParent());n.recycle();n=p;}if(n!=null)n.recycle();
        // Gesture fallback uses only a positively identified control's bounds, never a guessed screen point.
        if(target.isEmpty()||target.width()>width()/2||target.height()>dp(120))return false;
        CompletableFuture<Boolean> done=new CompletableFuture<>();handler.post(()->{if(token!=generation){done.complete(false);return;}Path path=new Path();path.moveTo(target.centerX(),target.centerY());boolean sent=dispatchGesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,65)).build(),new GestureResultCallback(){public void onCompleted(GestureDescription g){done.complete(true);}public void onCancelled(GestureDescription g){done.complete(false);}},handler);if(!sent)done.complete(false);});return done.get(2,TimeUnit.SECONDS);
    }
    static String link(String text){Matcher m=Pattern.compile("https?://[^\\s<>\"\\u200b，。；！、）】》]+").matcher(text);if(!m.find())return "";String value=m.group().replaceAll("[,;!]+$","");try{Uri u=Uri.parse(value);return u.getHost()!=null&&u.getUserInfo()==null&&value.length()<=8192?value:"";}catch(Exception e){return "";}}
    private void capture(){
        if(busy)return;if(reading.get()){message("上一页面尚未响应，请稍后重试");return;}cancel();busy=true;lastMessage="";final int token=generation;final long started=SystemClock.uptimeMillis();render();
        handler.postDelayed(()->{if(token==generation&&busy){cancel();record("timeout","page");message("页面读取超时，可收起或重试采集");}},12000);
        operation=reader.submit(()->{reading.set(true);try{check(token);
            AccessibilityNodeInfo root=page(null);if(root==null)throw new Exception("当前页面不可读取，请重新打开作品再试");String owner=pkg(root);root.recycle();
            record("capture_start",owner);if(!social(owner)&&!browser(owner))throw new Exception("请在浏览器、小红书、抖音或 B 站作品页使用");
            String value;
            if(browser(owner))value=browserLink(owner,token);else{
                AccessibilityNodeInfo copy=button(owner,true,token);
                if(copy==null){AccessibilityNodeInfo share=button(owner,false,token);if(share==null||!click(share,token))throw new Exception("当前页没有可采集的作品分享按钮，请先打开具体作品；列表页不支持整页采集");long until=SystemClock.uptimeMillis()+5000;while(copy==null&&SystemClock.uptimeMillis()<until){Thread.sleep(180);check(token);copy=button(owner,true,token);}}
                if(copy==null)throw new Exception("分享菜单中未识别到复制链接，请保持菜单打开后重试");
                long copiedAfter=System.currentTimeMillis();if(!click(copy,token))throw new Exception("复制链接按钮未响应，请重试");
                check(token);handler.post(()->{if(token==generation)openClipboard(owner,copiedAfter);});return;
            }
            check(token);final String result=value;handler.post(()->{if(token==generation)open(result);});
        }catch(InterruptedException ignored){}catch(Exception e){record("capture_failed",e.getClass().getSimpleName());handler.post(()->{if(token==generation)message(e.getMessage()==null?"采集未完成，请重试":e.getMessage());});}finally{reading.set(false);record("capture_finished","ms="+(SystemClock.uptimeMillis()-started));}});
    }
    private String browserLink(String owner,int token)throws Exception{
        for(int attempt=0;attempt<2;attempt++){
            AccessibilityNodeInfo address=find(page(owner),n->{String id=n.getViewIdResourceName();return id!=null&&id.matches(".*:id/(url_bar|urlbar_view|mozac_browser_toolbar_url_view|toolbar_url_view|location_bar_edit_text|url_input)");},token);
            if(address==null)break;address.refresh();String value=link(String.valueOf(address.getText()));
            if(attempt==1&&!value.isEmpty()&&!value.contains("…")){address.recycle();return value;}
            if(attempt==0){if(click(address,token)){Thread.sleep(250);continue;}break;}address.recycle();break;
        }throw new Exception("请显示完整地址栏，或用浏览器分享给 ZNote");
    }
    static boolean acceptsLink(String owner,String value){
        if(owner==null||owner.isEmpty())return true;
        String host=Uri.parse(value).getHost();if(host==null)return false;
        host=host.toLowerCase(Locale.ROOT);
        String[] domains=bilibili(owner)?new String[]{"bilibili.com","b23.tv"}:owner.equals("com.xingin.xhs")?new String[]{"xiaohongshu.com","xhslink.com","xhslink.cn"}:new String[]{"douyin.com","iesdouyin.com"};
        for(String domain:domains)if(host.equals(domain)||host.endsWith("."+domain))return true;return false;
    }
    private void openClipboard(String owner,long after){openPanel("",owner,after,true);}
    private void open(String value){openPanel(value,"",0,value.isEmpty());}
    private void openPanel(String value,String owner,long after,boolean clipboard){
        lastMessage="";cancel();expanded=false;render();
        try{startActivity(new Intent(this,FloatingShareActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(Intent.EXTRA_TEXT,value).putExtra("read_clipboard",clipboard).putExtra("source_package",owner).putExtra("copied_after",after));}
        catch(Exception e){message("无法打开采集面板，请重试");}
    }
    void notifyReady(){
        android.app.NotificationManager notifications=(android.app.NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        notifications.createNotificationChannel(new android.app.NotificationChannel("capture_ready","悬浮采集管理",android.app.NotificationManager.IMPORTANCE_LOW));
        android.app.PendingIntent settings=android.app.PendingIntent.getActivity(this,1,new Intent(this,CaptureAssistActivity.class),android.app.PendingIntent.FLAG_UPDATE_CURRENT|android.app.PendingIntent.FLAG_IMMUTABLE);
        android.app.PendingIntent show=android.app.PendingIntent.getActivity(this,2,new Intent(this,CaptureAssistActivity.class).putExtra("capture_action","show"),android.app.PendingIntent.FLAG_UPDATE_CURRENT|android.app.PendingIntent.FLAG_IMMUTABLE);
        android.app.Notification notification=new android.app.Notification.Builder(this,"capture_ready").setSmallIcon(R.drawable.ic_capture_notification).setContentTitle("ZNote · 采集辅助已连接").setContentText(visible()?"悬浮入口已就绪 · 点击管理":"悬浮窗已关闭 · 点击重新显示").setOngoing(true).setOnlyAlertOnce(true).setContentIntent(settings).addAction(new android.app.Notification.Action.Builder(null,"显示悬浮窗",show).build()).addAction(new android.app.Notification.Action.Builder(null,"采集设置",settings).build()).build();
        if(visible())try{if(Build.VERSION.SDK_INT>=34)startForeground(3741,notification,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(3741,notification);record("foreground","active");}catch(RuntimeException e){record("foreground_unavailable",e.getClass().getSimpleName());notifications.notify(3741,notification);}
        else{stopForeground(STOP_FOREGROUND_DETACH);notifications.notify(3741,notification);}
    }
}
