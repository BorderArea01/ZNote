package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.JSONObject;
import java.io.File;
import java.util.concurrent.*;

public class UpdateActivity extends Activity {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private TextView status,version;
    private Button action,check,cancel,notes;
    private ProgressBar progress;
    private AppUpdates.Release release;
    private boolean visible,busy,waitingPermission;
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private Button button(String title,Runnable run){Button b=new Button(this);b.setText(title);b.setAllCaps(false);b.setTextColor(0xffe7ebf5);b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff30394d));b.setMinHeight(dp(48));b.setOnClickListener(v->run.run());return b;}
    private TextView label(String text,int size){TextView v=new TextView(this);v.setText(text);v.setTextSize(size);v.setTextColor(0xffe7ebf5);v.setPadding(0,dp(12),0,dp(12));return v;}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);waitingPermission=state!=null&&state.getBoolean("waiting_permission");
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(24),dp(30),dp(24),dp(24));root.setBackgroundColor(0xff191c27);ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(root);setContentView(scroll);
        root.setOnApplyWindowInsetsListener((v,i)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars());v.setPadding(dp(24)+s.left,dp(24)+s.top,dp(24)+s.right,dp(24)+s.bottom);}return i;});
        root.addView(label("应用更新",26));root.addView(label("当前版本  "+AppUpdates.installedVersion(this),15));version=label("",18);root.addView(version);
        status=label("",14);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setVisibility(View.GONE);root.addView(progress);
        action=button("下载更新",this::download);action.setVisibility(View.GONE);root.addView(action);cancel=button("取消下载",()->{AppUpdates.clear(this);handler.removeCallbacksAndMessages(null);status.setText("已取消下载");showRelease();});cancel.setVisibility(View.GONE);root.addView(cancel);
        check=button("检查更新",this::check);root.addView(check);notes=button("查看更新内容",()->{TextView body=label(release==null?"":release.notes,15);body.setTextColor(0xff222222);body.setPadding(dp(20),dp(12),dp(20),dp(12));body.setTextIsSelectable(true);ScrollView content=new ScrollView(this);content.addView(body);new AlertDialog.Builder(this).setTitle("更新内容").setView(content).setPositiveButton("关闭",null).show();});notes.setVisibility(View.GONE);root.addView(notes);
        Switch automatic=new Switch(this);automatic.setText("自动检查更新");automatic.setTextColor(0xffe7ebf5);automatic.setPadding(0,dp(18),0,dp(18));automatic.setChecked(AppUpdates.prefs(this).getBoolean("auto_check",true));automatic.setOnCheckedChangeListener((v,value)->AppUpdates.prefs(this).edit().putBoolean("auto_check",value).apply());root.addView(automatic);
        root.addView(button("? 更新说明",()->new AlertDialog.Builder(this).setTitle("应用内更新").setMessage("自动检查每天最多一次，只提示新版本，不自动下载安装。下载由系统后台管理，可离开此页后继续。\n\n安装前会校验文件、包名、版本和签名；系统仍会要求你确认安装。覆盖更新保留服务器地址、登录状态和已有配置，不需要卸载。\n\n这里更新 Android 客户端，电脑或 NAS 上的知识库服务需单独更新。首次安装更新时，系统可能要求允许 ZNote 安装应用。") .setPositiveButton("知道了",null).show()));
        root.addView(button("返回",this::finish));
        try{String saved=AppUpdates.prefs(this).getString("release","");if(!saved.isEmpty())release=AppUpdates.Release.read(new JSONObject(saved));if(release!=null&&AppUpdates.compare(release.version,AppUpdates.installedVersion(this))<=0){AppUpdates.clear(this);release=null;}}catch(Exception e){AppUpdates.clear(this);}
        if(release==null)check();else showRelease();
    }
    private void ui(Runnable run){runOnUiThread(()->{if(!isDestroyed()&&!isFinishing())run.run();});}
    private void showRelease(){boolean found=release!=null;version.setText(found?"可更新至  "+release.version:"");action.setVisibility(found?View.VISIBLE:View.GONE);action.setText("下载更新");action.setEnabled(true);check.setEnabled(!busy);action.setOnClickListener(v->download());notes.setVisibility(found?View.VISIBLE:View.GONE);cancel.setVisibility(View.GONE);progress.setVisibility(View.GONE);}
    private void check(){if(busy||AppUpdates.prefs(this).getLong("download_id",0)!=0)return;busy=true;check.setEnabled(false);action.setEnabled(false);status.setText("正在检查更新…");worker.execute(()->{try{AppUpdates.Release result=AppUpdates.check(this);ui(()->{release=result;showRelease();status.setText(result==null?"已是当前最新版本":"更新大小  "+String.format(java.util.Locale.ROOT,"%.1f MB",result.size/1048576d));});}catch(Exception e){ui(()->status.setText("无法检查更新，请检查网络后重试"));}finally{ui(()->{busy=false;check.setEnabled(true);action.setEnabled(true);});}});}
    private void download(){if(release==null||busy)return;try{AppUpdates.download(this,release);poll();}catch(Exception e){status.setText("下载未开始，请检查存储空间或网络后重试");}}
    private void poll(){
        if(!visible||isDestroyed())return;long id=AppUpdates.prefs(this).getLong("download_id",0);if(id==0)return;
        try(Cursor c=((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).query(new DownloadManager.Query().setFilterById(id))){
            if(c==null||!c.moveToFirst()){AppUpdates.clear(this);showRelease();status.setText("下载记录已移除，可以重新下载");return;}
            int state=c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if(state==DownloadManager.STATUS_SUCCESSFUL){progress.setVisibility(View.GONE);cancel.setVisibility(View.VISIBLE);cancel.setText("删除安装包");action.setVisibility(View.VISIBLE);action.setEnabled(!busy);action.setText("安装更新");action.setOnClickListener(v->install());check.setEnabled(false);if(!busy)status.setText("下载完成，点击安装更新");return;}
            if(state==DownloadManager.STATUS_FAILED){int reason=c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));AppUpdates.clear(this);showRelease();status.setText("下载失败（"+reason+"），可重新下载");check.setEnabled(true);return;}
            long done=c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),total=c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));progress.setVisibility(View.VISIBLE);progress.setIndeterminate(total<=0);if(total>0)progress.setProgress((int)(done*100/total));status.setText(state==DownloadManager.STATUS_PAUSED?"等待网络，恢复后继续下载":"正在下载 "+(total>0?(done*100/total)+"%":"…"));action.setEnabled(false);check.setEnabled(false);cancel.setText("取消下载");cancel.setVisibility(View.VISIBLE);handler.postDelayed(this::poll,700);
        }catch(Exception e){status.setText("暂时无法读取下载进度，请返回后重试");}
    }
    private void install(){
        if(busy||release==null)return;
        if(!getPackageManager().canRequestPackageInstalls()){waitingPermission=true;try{startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));}catch(Exception e){waitingPermission=false;status.setText("请在系统设置允许 ZNote 安装应用，再回来点击安装");}return;}
        busy=true;action.setEnabled(false);check.setEnabled(false);cancel.setEnabled(false);status.setText("正在校验安装包…");final AppUpdates.Release expected=release;final long id=AppUpdates.prefs(this).getLong("download_id",0);
        worker.execute(()->{try{File file=new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),"znote-update-"+expected.version+".apk");AppUpdates.verify(this,file,expected);Uri uri=((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).getUriForDownloadedFile(id);if(uri==null)throw new java.io.IOException("安装包已被移除");ui(()->{try{startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));status.setText("请在系统窗口确认更新；取消后可再次安装");}catch(Exception e){status.setText("无法打开系统安装界面，请检查安装权限");}});}catch(Exception e){ui(()->{AppUpdates.clear(this);showRelease();status.setText(e.getMessage());});}finally{ui(()->{busy=false;action.setEnabled(true);check.setEnabled(AppUpdates.prefs(this).getLong("download_id",0)==0);cancel.setEnabled(true);});}});
    }
    @Override protected void onResume(){super.onResume();visible=true;poll();if(waitingPermission){waitingPermission=false;if(getPackageManager().canRequestPackageInstalls())install();else status.setText("尚未允许安装；下载的安装包已保留");}}
    @Override protected void onPause(){visible=false;handler.removeCallbacksAndMessages(null);super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putBoolean("waiting_permission",waitingPermission);}
    @Override protected void onDestroy(){worker.shutdownNow();super.onDestroy();}
}
