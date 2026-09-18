package io.github.borderarea01.capturefixture;
import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.widget.*;
import android.view.*;
public class PageActivity extends Activity {
  @Override public void onCreate(Bundle state){super.onCreate(state);
    LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setPadding(30,90,30,30);page.setBackgroundColor(0xfff1f3f8);setContentView(page);
    boolean browser=getPackageName().equals("com.chrome.beta");
    final String url=browser?"https://example.com/fixture-article":getPackageName().equals("com.xingin.xhs")?"https://xhslink.cn/a/fixture-note":getPackageName().equals("tv.danmaku.bili")?"https://b23.tv/fixture-work":"https://v.douyin.com/fixture-work/";
    if(browser){EditText bar=new EditText(this);bar.setId(R.id.url_bar);bar.setSingleLine(true);bar.setText("example.com");bar.setOnClickListener(v->bar.setText(url));page.addView(bar);}
    TextView title=new TextView(this);title.setText("手机采集交互测试\n\n图标分享按钮 · 独立分享面板\n\n仅用于验证交互，不代替真实 App 验收。");title.setTextSize(21);page.addView(title);
    if(getIntent().getBooleanExtra("list",false)){TextView list=new TextView(this);list.setText("稍后再看\n视频甲\n视频乙\n视频丙");page.addView(list);return;}
    if(!browser){boolean douyin=getPackageName().equals("com.ss.android.ugc.aweme");Button share=new Button(this);share.setText("");share.setContentDescription(douyin?"":getPackageName().equals("com.xingin.xhs")?"分享笔记":"分享，按钮");if(douyin)share.setId(R.id.share_action_button);share.setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_share,0,0,0);page.addView(share);Runnable showShare=()->{
        if(getIntent().getBooleanExtra("slow",false))try{Thread.sleep(5000);}catch(InterruptedException ignored){}
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(20,20,20,20);TextView header=new TextView(this);header.setText("分享至");header.setTextSize(22);panel.addView(header);
        if(!getIntent().getBooleanExtra("copyOnly",false)){Button direct=new Button(this);direct.setText("ZNote");direct.setContentDescription("ZNote");panel.addView(direct);direct.setOnClickListener(w->{Intent send=new Intent(Intent.ACTION_SEND).setType("text/plain").setPackage("io.github.borderarea01.znote").putExtra(Intent.EXTRA_TEXT,"分享作品 "+url);startActivity(send);});}
        LinearLayout tile=new LinearLayout(this);tile.setPadding(30,30,30,30);TextView icon=new TextView(this);icon.setText("↗");tile.addView(icon);TextView label=new TextView(this);label.setText(douyin?"复制链接到剪贴板":"复制\n链接");tile.addView(label);panel.addView(tile);
        AlertDialog dialog=new AlertDialog.Builder(this).setView(panel).create();tile.setOnClickListener(w->{((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("作品","分享作品 "+url+"，复制本条信息打开 App"));dialog.dismiss();});dialog.show();dialog.getWindow().setGravity(Gravity.BOTTOM);
    };share.setOnClickListener(v->showShare.run());if(getIntent().getBooleanExtra("menuOpen",false))page.post(showShare);}
  }
}
