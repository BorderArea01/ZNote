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
    private Button button(String text,Runnable run){Button b=new Button(this);b.setText(text);b.setAllCaps(false);b.setOnClickListener(v->run.run());return b;}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(24),dp(48),dp(24),dp(32));root.setBackgroundColor(0xff161b28);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(root);setContentView(scroll);
        root.setOnApplyWindowInsetsListener((v,i)->{if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars());v.setPadding(dp(24)+s.left,dp(24)+s.top,dp(24)+s.right,dp(24)+s.bottom);}return i;});
        TextView title=new TextView(this);title.setText("悬浮采集");title.setTextSize(26);title.setTextColor(0xffe7ebf5);title.setPadding(0,0,0,dp(20));root.addView(title);
        root.addView(button("? 使用与权限说明",()->new AlertDialog.Builder(this).setTitle("点击时才读取页面").setMessage(getString(io.github.borderarea01.znote.R.string.capture_accessibility_description)+"\n\n拖动 Z 按钮可换位置，松手自动贴边；点开后可收起或关闭。浏览器需要显示地址栏。App 版本不同，分享按钮可能无法识别，此时从原 App 分享给 ZNote 或复制链接后粘贴即可。\n\n悬浮入口负责取得链接，图片和视频由服务器下载；它不能绕过平台登录，也不能直接读取其他 App 的内部文件。") .setPositiveButton("知道了",null).show()));
        status=new TextView(this);status.setTextColor(0xffc3cde1);status.setTextSize(15);status.setPadding(0,dp(20),0,dp(20));root.addView(status);
        root.addView(button("开启 / 管理采集辅助",()->new AlertDialog.Builder(this).setTitle("开启点击采集").setMessage(getString(R.string.capture_accessibility_description)).setNegativeButton("取消",null).setPositiveButton("前往系统设置",(d,w)->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))).show()));
        root.addView(button("显示悬浮窗",()->command("show")));
        root.addView(button("关闭悬浮窗",()->command("hide")));
        root.addView(button("开启通知栏管理入口",()->{
            if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},37);
            else {if(CaptureAssistService.current!=null)CaptureAssistService.current.notifyReady();startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));}
        }));
        root.addView(button("粘贴链接采集",()->startActivity(new Intent(this,FloatingShareActivity.class).putExtra("read_clipboard",true))));
        root.addView(button("返回",this::finish));
    }
    private void command(String action){
        CaptureAssistService service=CaptureAssistService.current;
        if(service==null){status.setText("采集辅助未连接，请在系统设置中重新开启 ZNote 点击采集");return;}
        if("show".equals(action))service.setVisible(true);else if("hide".equals(action))service.setVisible(false);
        status.setText("采集辅助已连接 · "+(service.visible()?"悬浮窗已显示":"悬浮窗已关闭")+(service.capturing()?" · 正在识别":""));
    }
    @Override protected void onResume(){super.onResume();String action=getIntent().getStringExtra("capture_action");getIntent().removeExtra("capture_action");command(action==null?"status":action);if("show".equals(action))finish();}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(code==37){if(CaptureAssistService.current!=null)CaptureAssistService.current.notifyReady();status.setText(grants.length>0&&grants[0]==android.content.pm.PackageManager.PERMISSION_GRANTED?"通知栏管理入口已开启":"通知未获允许，可在系统设置中开启；悬浮采集仍可使用");}}
}
