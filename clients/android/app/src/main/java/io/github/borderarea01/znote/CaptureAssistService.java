package io.github.borderarea01.znote;

import android.accessibilityservice.AccessibilityService;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.view.accessibility.*;
import android.widget.*;
import java.util.*;
import java.util.regex.*;

/** No event scanning, network interception, screenshots or background clipboard polling. */
public class CaptureAssistService extends AccessibilityService {
    static CaptureAssistService current;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private WindowManager manager;
    private WindowManager.LayoutParams layout;
    private LinearLayout bubble;
    private TextView status;
    private boolean expanded=false,busy=false;
    private String sourcePackage="";
    private long started;
    private boolean editedAddress=false;
    private SharedPreferences prefs(){return getSharedPreferences("MainActivity",MODE_PRIVATE);}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override protected void onServiceConnected(){current=this;manager=(WindowManager)getSystemService(WINDOW_SERVICE);if(prefs().getBoolean("capture_bubble",true))showBubble();}
    @Override public void onAccessibilityEvent(AccessibilityEvent event){/* Deliberately idle until an explicit capture tap. */}
    @Override public void onInterrupt(){cancel();}
    @Override public void onDestroy(){hideBubble();if(current==this)current=null;super.onDestroy();}
    @Override public void onConfigurationChanged(Configuration config){super.onConfigurationChanged(config);if(bubble!=null){cancel();expanded=false;render();}}
    private int width(){return getResources().getDisplayMetrics().widthPixels;}
    private int height(){return getResources().getDisplayMetrics().heightPixels;}
    private GradientDrawable background(){GradientDrawable g=new GradientDrawable();g.setColor(0xff202738);g.setCornerRadius(dp(18));g.setStroke(dp(1),0xff566581);return g;}
    private TextView control(String text,String description,Runnable action){TextView b=new TextView(this);b.setText(text);b.setContentDescription(description);b.setTextSize(14);b.setTextColor(0xffedf2ff);b.setGravity(Gravity.CENTER);b.setMinHeight(dp(48));b.setPadding(dp(12),dp(6),dp(12),dp(6));b.setFocusable(true);b.setOnClickListener(v->action.run());return b;}
    public void showBubble(){if(manager==null)return;if(bubble==null){bubble=new LinearLayout(this);bubble.setOrientation(LinearLayout.VERTICAL);bubble.setBackground(background());bubble.setElevation(dp(8));layout=new WindowManager.LayoutParams(dp(48),-2,WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT);layout.gravity=Gravity.TOP|Gravity.LEFT;manager.addView(bubble,layout);}render();}
    public void hideBubble(){cancel();if(bubble!=null){manager.removeView(bubble);bubble=null;}expanded=false;}
    private void cancel(){handler.removeCallbacksAndMessages(null);busy=false;sourcePackage="";if(bubble!=null){layout.flags=WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;manager.updateViewLayout(bubble,layout);}}
    private void dock(){
        if(bubble==null)return;
        int w=expanded?Math.min(dp(256),width()-dp(32)):dp(48);
        layout.width=w;layout.x=prefs().getBoolean("capture_right",true)?Math.max(0,width()-w):0;
        int available=Math.max(dp(32),height()-dp(expanded?320:96));
        layout.y=Math.max(dp(24),Math.min(available,Math.round(prefs().getFloat("capture_y",.38f)*available)));
        manager.updateViewLayout(bubble,layout);
    }
    private void render(){
        if(bubble==null)return;bubble.removeAllViews();
        layout.flags=WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;
        TextView handle=control(expanded?"⠿  ZNote":"Z","ZNote 悬浮采集，拖动换位置",()->{if(busy)return;expanded=!expanded;render();});bubble.addView(handle);drag(handle);
        if(expanded){
            bubble.addView(control("获取当前页面","获取当前页面",this::capture));
            bubble.addView(control("粘贴链接","粘贴链接",()->open("")));
            status=control("","采集状态",()->{});status.setTextSize(12);status.setMinHeight(0);bubble.addView(status);
            LinearLayout actions=new LinearLayout(this);actions.addView(control("收起","收起悬浮采集",()->{cancel();expanded=false;render();}),new LinearLayout.LayoutParams(0,-2,1));actions.addView(control("关闭","关闭悬浮采集",()->{prefs().edit().putBoolean("capture_bubble",false).apply();hideBubble();}),new LinearLayout.LayoutParams(0,-2,1));bubble.addView(actions);
        }else status=null;dock();
    }
    private void drag(View handle){handle.setOnTouchListener(new View.OnTouchListener(){float x,y;int ox,oy;boolean moved;public boolean onTouch(View v,MotionEvent e){switch(e.getActionMasked()){
        case MotionEvent.ACTION_DOWN:x=e.getRawX();y=e.getRawY();ox=layout.x;oy=layout.y;moved=false;return true;
        case MotionEvent.ACTION_MOVE:float dx=e.getRawX()-x,dy=e.getRawY()-y;if(Math.hypot(dx,dy)>dp(8))moved=true;if(moved){layout.x=Math.max(0,Math.min(width()-layout.width,ox+(int)dx));layout.y=Math.max(dp(24),Math.min(height()-bubble.getHeight()-dp(32),oy+(int)dy));manager.updateViewLayout(bubble,layout);}return true;
        case MotionEvent.ACTION_UP:if(!moved)v.performClick();else{prefs().edit().putBoolean("capture_right",layout.x+layout.width/2>width()/2).putFloat("capture_y",Math.max(0,Math.min(1,layout.y/(float)Math.max(1,height()-dp(96))))).apply();cancel();expanded=false;render();}return true;
        case MotionEvent.ACTION_CANCEL:dock();return true;
        default:return false;}}});}
    private void message(String text){busy=false;handler.removeCallbacksAndMessages(null);if(status!=null)status.setText(text);}
    private static boolean social(String pkg){return pkg.equals("com.xingin.xhs")||pkg.equals("com.ss.android.ugc.aweme")||pkg.equals("com.ss.android.ugc.aweme.lite");}
    private static boolean browser(String pkg){return Arrays.asList("com.android.chrome","com.chrome.beta","com.microsoft.emmx","org.mozilla.firefox","org.mozilla.fenix","com.sec.android.app.sbrowser","com.heytap.browser","com.vivo.browser","com.UCMobile").contains(pkg);}
    private AccessibilityNodeInfo page(){
        // A click can change an address bar/share menu without a window-state event.
        // Fetch one fresh snapshot on demand instead of subscribing to every page mutation.
        if(Build.VERSION.SDK_INT>=33)clearCache();
        for(AccessibilityWindowInfo w:getWindows())if(w.getType()==AccessibilityWindowInfo.TYPE_APPLICATION&&(w.isActive()||w.isFocused())){AccessibilityNodeInfo root=w.getRoot();if(root!=null)return root;}
        return getRootInActiveWindow();
    }
    private interface Match {boolean test(AccessibilityNodeInfo node);}
    private AccessibilityNodeInfo find(AccessibilityNodeInfo root,Match match){
        ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);int count=0;
        while(!queue.isEmpty()&&count++<600){AccessibilityNodeInfo n=queue.removeFirst();if(Build.VERSION.SDK_INT<33&&!n.refresh()){n.recycle();continue;}if(n.isVisibleToUser()&&!n.isPassword()&&match.test(n)){for(AccessibilityNodeInfo rest:queue)rest.recycle();return n;}for(int i=0;i<n.getChildCount()&&queue.size()<600;i++){AccessibilityNodeInfo child=n.getChild(i);if(child!=null)queue.add(child);}n.recycle();}
        for(AccessibilityNodeInfo n:queue)n.recycle();return null;
    }
    private String pkg(AccessibilityNodeInfo n){return n.getPackageName()==null?"":n.getPackageName().toString();}
    private boolean click(AccessibilityNodeInfo n){for(int i=0;n!=null&&i<4;i++){if(n.isClickable()&&n.isEnabled()){boolean ok=n.performAction(AccessibilityNodeInfo.ACTION_CLICK);n.recycle();return ok;}AccessibilityNodeInfo p=n.getParent();n.recycle();n=p;}if(n!=null)n.recycle();return false;}
    private static String label(AccessibilityNodeInfo n){return String.valueOf(n.getText()==null?n.getContentDescription():n.getText()).trim();}
    static String link(String text){Matcher m=Pattern.compile("https?://[^\\s<>\"\\u200b]+").matcher(text);if(!m.find())return "";String result=m.group().replaceAll("[，。；！、）】》,;!]+$","");try{Uri u=Uri.parse(result);if(u.getHost()==null||u.getUserInfo()!=null||result.length()>8192)return "";return result;}catch(Exception e){return "";}}
    private void capture(){
        if(busy)return;AccessibilityNodeInfo root=page();if(root==null){message("当前页面不可读取，可从原 App 分享给 ZNote");return;}
        sourcePackage=pkg(root);if(!browser(sourcePackage)&&!social(sourcePackage)){root.recycle();message("请在浏览器、小红书或抖音的作品页使用");return;}
        busy=true;started=System.currentTimeMillis();editedAddress=false;if(status!=null)status.setText("正在获取当前链接…");
        if(browser(sourcePackage)){readBrowser(root,false);return;}
        AccessibilityNodeInfo copy=find(AccessibilityNodeInfo.obtain(root),n->label(n).matches("^(复制链接|复制分享链接|Copy link)$"));
        if(copy!=null){copy.recycle();root.recycle();copyLink(0);return;}
        AccessibilityNodeInfo share=find(root,n->label(n).matches("^(分享|转发|Share)(按钮|作品|视频|笔记|给朋友)?([ ·,，]?\\d+(\\.\\d+)?[万wWkK]?)?$"));
        if(share==null||!click(share)){message("未找到分享按钮，请先打开作品的分享菜单，再点采集");return;}
        handler.postDelayed(()->copyLink(0),450);
    }
    private void readBrowser(AccessibilityNodeInfo root,boolean focused){
        AccessibilityNodeInfo address=find(root,n->{String id=n.getViewIdResourceName();return id!=null&&id.matches(".*:id/(url_bar|urlbar_view|mozac_browser_toolbar_url_view|toolbar_url_view|location_bar_edit_text|url_input)");});
        if(address==null){message("请显示浏览器地址栏，或用分享 / 复制链接采集");return;}
        address.refresh();
        String value=link(label(address));
        if(focused&&!value.isEmpty()&&!value.contains("…")){address.recycle();if(editedAddress){performGlobalAction(GLOBAL_ACTION_BACK);handler.postDelayed(()->open(value),200);}else open(value);return;}
        if(!focused&&click(address)){editedAddress=true;handler.postDelayed(()->{AccessibilityNodeInfo next=page();if(next==null||!sourcePackage.equals(pkg(next))){if(next!=null)next.recycle();message("页面已切换，请重新采集");return;}readBrowser(next,true);},450);}
        else{if(focused){address.recycle();if(editedAddress)performGlobalAction(GLOBAL_ACTION_BACK);}message("未读到完整网址，请用浏览器分享给 ZNote");}
    }
    private void copyLink(int attempt){
        AccessibilityNodeInfo root=page();if(root==null){message("无法读取分享菜单，请直接分享给 ZNote");return;}
        if(!sourcePackage.equals(pkg(root))){root.recycle();message("页面已切换，请从分享菜单选择 ZNote");return;}
        AccessibilityNodeInfo copy=find(root,n->label(n).matches("^(复制链接|复制分享链接|Copy link)$"));
        if(copy!=null&&click(copy)){
            // Clipboard is read only after this tap caused Copy link; stale clipboard is rejected.
            layout.flags=WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;manager.updateViewLayout(bubble,layout);bubble.setFocusableInTouchMode(true);bubble.requestFocus();handler.postDelayed(()->readCopied(0),350);return;
        }
        if(attempt<5){handler.postDelayed(()->copyLink(attempt+1),400);return;}message("未找到复制链接，请从分享菜单选择 ZNote");
    }
    private void readCopied(int attempt){
        ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);ClipData clip=null;
        try{ClipDescription description=clipboard.getPrimaryClipDescription();clip=description!=null&&description.getTimestamp()>=started?clipboard.getPrimaryClip():null;}catch(SecurityException ignored){}
        String value=clip!=null&&clip.getItemCount()>0?link(String.valueOf(clip.getItemAt(0).getText())):"";
        String host=Uri.parse(value).getHost();boolean correct=host!=null&&(sourcePackage.equals("com.xingin.xhs")?host.matches("(^|.*\\.)(xiaohongshu\\.com|xhslink\\.com)"):host.matches("(^|.*\\.)(douyin\\.com|iesdouyin\\.com)"));
        if(correct){open(value);return;}if(attempt<4){handler.postDelayed(()->readCopied(attempt+1),300);return;}
        layout.flags=WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL;manager.updateViewLayout(bubble,layout);message("未取得本次复制的作品链接，可点粘贴链接继续");
    }
    private void open(String value){cancel();expanded=false;render();Intent intent=new Intent(this,ShareActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(Intent.EXTRA_TEXT,value);try{startActivity(intent);}catch(Exception e){expanded=true;render();message("无法打开采集页，请从原 App 分享给 ZNote");}}
}
