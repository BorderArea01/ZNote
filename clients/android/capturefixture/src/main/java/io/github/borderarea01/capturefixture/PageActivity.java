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
    final String url=browser?"https://example.com/fixture-article":getPackageName().equals("com.xingin.xhs")?"https://xhslink.com/a/fixture-note":"https://v.douyin.com/fixture-work/";
    if(browser){EditText bar=new EditText(this);bar.setId(R.id.url_bar);bar.setSingleLine(true);bar.setText("example.com");bar.setOnClickListener(v->bar.setText(url));page.addView(bar);}
    TextView title=new TextView(this);title.setText("手机采集交互测试\n\n图标分享按钮 · 独立分享面板\n\n仅用于验证交互，不代替真实 App 验收。");title.setTextSize(21);page.addView(title);
    if(!browser){Button share=new Button(this);share.setText("");share.setContentDescription("分享，按钮");share.setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_menu_share,0,0,0);page.addView(share);share.setOnClickListener(v->{
        LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(20,20,20,20);TextView header=new TextView(this);header.setText("分享至");header.setTextSize(22);panel.addView(header);
        LinearLayout tile=new LinearLayout(this);tile.setPadding(30,30,30,30);TextView icon=new TextView(this);icon.setText("↗");tile.addView(icon);TextView label=new TextView(this);label.setText("复制\n链接");tile.addView(label);panel.addView(tile);
        AlertDialog dialog=new AlertDialog.Builder(this).setView(panel).create();tile.setOnClickListener(w->{((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("作品","分享作品 "+url+"，复制本条信息打开 App"));dialog.dismiss();});dialog.show();dialog.getWindow().setGravity(Gravity.BOTTOM);
    });}
  }
}
