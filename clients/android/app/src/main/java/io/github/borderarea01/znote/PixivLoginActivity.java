package io.github.borderarea01.znote;

import android.app.*;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.view.*;
import android.webkit.*;
import android.widget.*;

/** Pixiv owns the login page. Credentials never enter ZNote forms or logs. */
public class PixivLoginActivity extends Activity {
    private WebView web;
    private TextView status;
    private boolean pageFailed;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);NativeAppearance.load(this);NativeAppearance.window(this);LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(0,32,0,0);root.setBackgroundColor(NativeUi.BG);
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);TextView title=NativeUi.label(this,"Pixiv 登录",17);bar.addView(title,new LinearLayout.LayoutParams(0,NativeUi.dp(this,56),1));
        bar.addView(NativeUi.button(this,"取消",this::finish));bar.addView(NativeUi.button(this,"完成登录",this::complete));root.addView(bar);
        status=NativeUi.label(this,"正在打开 Pixiv 官方登录页…",13);status.setPadding(20,12,20,12);status.setOnClickListener(v->web.reload());root.addView(status);
        web=new WebView(this);web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){Uri u=request.getUrl();String host=u.getHost();if("https".equals(u.getScheme())&&host!=null&&(host.equals("pixiv.net")||host.endsWith(".pixiv.net")))return false;if("https".equals(u.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}return true;}
            @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){pageFailed=false;status.setText("正在打开 Pixiv 官方登录页…");status.setVisibility(View.VISIBLE);}
            @Override public void onPageFinished(WebView v,String url){if(!pageFailed)status.setVisibility(View.GONE);}
            @Override public void onReceivedError(WebView v,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame()){pageFailed=true;status.setText("登录页加载失败，请确认手机代理可用；点此重试");status.setVisibility(View.VISIBLE);}}
            @Override public void onReceivedHttpError(WebView v,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=400){pageFailed=true;status.setText("Pixiv 登录页 HTTP "+response.getStatusCode()+"；点此重试");status.setVisibility(View.VISIBLE);}}
        });
        root.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);web.loadUrl("https://accounts.pixiv.net/login?source=pc&view_type=page&ref=https%3A%2F%2Fwww.pixiv.net%2F");
    }
    private void complete(){CookieManager.getInstance().flush();if(!PixivSession.loggedIn()){Toast.makeText(this,"尚未检测到 Pixiv 登录，请先完成官方页面登录",Toast.LENGTH_LONG).show();return;}Runnable done=()->{setResult(RESULT_OK);finish();};if(getIntent().getBooleanExtra("active_capture",false))done.run();else PixivRecovery.offer(this,done);}
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(web!=null){web.stopLoading();web.destroy();}super.onDestroy();}
}
