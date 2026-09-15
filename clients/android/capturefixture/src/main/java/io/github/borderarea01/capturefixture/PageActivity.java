package io.github.borderarea01.capturefixture;
import android.app.Activity;
import android.os.Bundle;
import android.content.*;
import android.widget.*;

/** Deterministic accessible controls, not a claim of real platform compatibility. */
public class PageActivity extends Activity {
  @Override public void onCreate(Bundle state){super.onCreate(state);
    LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setPadding(30,90,30,30);page.setBackgroundColor(0xfff1f3f8);setContentView(page);
    boolean browser=getPackageName().equals("com.chrome.beta");
    final String url=browser?"https://example.com/fixture-article":getPackageName().equals("com.xingin.xhs")?"https://xhslink.com/a/fixture-note":"https://v.douyin.com/fixture-work/";
    if(browser){EditText bar=new EditText(this);bar.setId(R.id.url_bar);bar.setSingleLine(true);bar.setText("example.com");bar.setOnClickListener(v->bar.setText(url));page.addView(bar);}
    TextView title=new TextView(this);title.setText("手机采集交互测试\n\n这是模拟页面，用于验证悬浮窗、拖动、分享按钮与复制链接。\n\n实际平台的界面兼容性需另行验证。");title.setTextSize(21);page.addView(title);
    if(!browser){Button share=new Button(this);share.setText("分享");page.addView(share);share.setOnClickListener(v->{share.setVisibility(android.view.View.GONE);Button copy=new Button(this);copy.setText("复制链接");page.addView(copy);copy.setOnClickListener(w->{((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("作品",url));page.removeView(copy);share.setVisibility(android.view.View.VISIBLE);});});}
  }
}
