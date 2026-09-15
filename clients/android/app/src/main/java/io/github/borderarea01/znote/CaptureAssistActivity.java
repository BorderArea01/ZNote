package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import android.provider.Settings;
import android.view.*;
import android.widget.*;

/** Explicit, optional setup. The system accessibility permission is never silently enabled. */
public class CaptureAssistActivity extends Activity {
    private TextView status;
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private Button button(String text,Runnable run){return NativeUi.button(this,text,run);}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(24),dp(48),dp(24),dp(32));root.setBackgroundColor(0xff161b28);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(root);setContentView(scroll);
        root.setOnApplyWindowInsetsListener((v,i)->{if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars());v.setPadding(dp(24)+s.left,dp(24)+s.top,dp(24)+s.right,dp(24)+s.bottom);}return i;});
        TextView title=new TextView(this);title.setText("悬浮采集");title.setTextSize(26);title.setTextColor(0xffe7ebf5);title.setPadding(0,0,0,0);LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);header.addView(title,new LinearLayout.LayoutParams(0,-2,1));Button close=button("×",this::finish);close.setContentDescription("关闭设置");NativeUi.quiet(close);header.addView(close,new LinearLayout.LayoutParams(dp(48),dp(48)));root.addView(header);
        LinearLayout access=NativeUi.card(root,"采集辅助");
        NativeUi.row(access,button("? 使用与权限说明",()->new AlertDialog.Builder(this).setTitle("点击时才读取页面").setMessage(getString(io.github.borderarea01.znote.R.string.capture_accessibility_description)+"\n\n拖动 Z 按钮可换位置，松手自动贴边；点开后可收起或关闭。浏览器需要显示地址栏。App 版本不同，分享按钮可能无法识别，此时从原 App 分享给 ZNote 或复制链接后粘贴即可。\n\n悬浮入口负责取得链接，图片和视频由服务器下载；它不能绕过平台登录，也不能直接读取其他 App 的内部文件。") .setPositiveButton("知道了",null).show()));
        status=new TextView(this);status.setTextColor(0xffc3cde1);status.setTextSize(15);status.setPadding(0,dp(20),0,dp(20));access.addView(status);
        NativeUi.row(access,button("开启 / 管理采集辅助",()->new AlertDialog.Builder(this).setTitle("开启点击采集").setMessage(getString(R.string.capture_accessibility_description)).setNegativeButton("取消",null).setPositiveButton("前往系统设置",(d,w)->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))).show()));
        LinearLayout visibility=new LinearLayout(this);visibility.setGravity(Gravity.CENTER);access.addView(visibility);
        Button show=button("显示悬浮窗",()->command("show"));NativeUi.primary(show);visibility.addView(show,new LinearLayout.LayoutParams(0,dp(48),1));
        Button hide=button("关闭悬浮窗",()->command("hide"));NativeUi.quiet(hide);visibility.addView(hide,new LinearLayout.LayoutParams(0,dp(48),1));
        LinearLayout system=NativeUi.card(root,"后台与通知");
        NativeUi.row(system,button("后台运行 / 电池设置",()->{try{startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName())));}catch(RuntimeException e){status.setText("请在系统应用管理中打开 ZNote 的电池与后台运行设置");}}));
        NativeUi.row(system,button("? 悬浮窗消失或响应慢",()->new AlertDialog.Builder(this).setTitle("保持采集入口可用").setMessage("悬浮窗开启时，ZNote 使用前台服务和通知栏管理入口；关闭悬浮窗后停止前台运行。\n\n部分系统还会限制应用后台运行。可在 ZNote 的系统应用设置中检查电池限制与自启动。若无障碍采集辅助已被系统关闭，需要你重新开启，应用不能自行恢复权限。\n\n采集运行诊断会记录服务启动、系统退出原因及点击排队耗时，可复制给维护者定位卡顿。") .setPositiveButton("知道了",null).show()));
        NativeUi.row(system,button("开启通知栏管理入口",()->{
            if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},37);
            else {if(CaptureAssistService.current!=null)CaptureAssistService.current.notifyReady();startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));}
        }));
        LinearLayout tools=NativeUi.card(root,"工具");
        NativeUi.row(tools,button("粘贴链接采集",()->startActivity(new Intent(this,FloatingShareActivity.class).putExtra("read_clipboard",true))));
        NativeUi.row(tools,button("采集运行诊断",()->{String log="尚无记录";try{log=new String(java.nio.file.Files.readAllBytes(new java.io.File(getFilesDir(),"capture-diagnostics.log").toPath()),java.nio.charset.StandardCharsets.UTF_8);if(log.length()>6000)log=log.substring(log.length()-6000);}catch(Exception ignored){}final String value=log;new AlertDialog.Builder(this).setTitle("采集运行诊断").setMessage(value).setPositiveButton("复制诊断",(d,w)->((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("ZNote 采集诊断",value))).setNegativeButton("关闭",null).show();}));

        NativeUi.row(tools,button("检查应用更新",()->startActivity(new Intent(this,UpdateActivity.class))));
    }
    private void command(String action){
        CaptureAssistService service=CaptureAssistService.current;
        if(service==null){String enabled=Settings.Secure.getString(getContentResolver(),Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);boolean permitted=false;if(enabled!=null)for(String name:enabled.split(":")){ComponentName component=ComponentName.unflattenFromString(name);if(component!=null&&component.equals(new ComponentName(this,CaptureAssistService.class)))permitted=true;}status.setText(permitted?"无障碍权限已开启，但采集服务尚未连接；请检查后台运行限制，或在系统设置中重新开启采集辅助":"无障碍采集辅助已关闭；请点击下方管理入口重新开启");return;}
        if("show".equals(action))service.setVisible(true);else if("hide".equals(action))service.setVisible(false);
        status.setText("采集辅助已连接 · "+(service.visible()?"悬浮窗已显示":"悬浮窗已关闭")+(service.capturing()?" · 正在识别":""));
    }
    @Override protected void onResume(){super.onResume();String action=getIntent().getStringExtra("capture_action");getIntent().removeExtra("capture_action");command(action==null?"status":action);if("show".equals(action))finish();}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(code==37){if(CaptureAssistService.current!=null)CaptureAssistService.current.notifyReady();status.setText(grants.length>0&&grants[0]==android.content.pm.PackageManager.PERMISSION_GRANTED?"通知栏管理入口已开启":"通知未获允许，可在系统设置中开启；悬浮采集仍可使用");}}
}
