package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;
import java.net.URI;
import java.net.URL;
import java.net.HttpURLConnection;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private LinearLayout root;
    private WebView web;
    private String origin="";
    private ValueCallback<Uri[]> chooser;
    private String draft;
    private View fullScreen;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private final java.util.concurrent.ExecutorService network=Executors.newSingleThreadExecutor();
    private int attempt=0;
    private boolean backBusy=false;
    private android.window.OnBackInvokedCallback backCallback;
    private static final int PICK=20,SAVE=21;
    @Override public void onCreate(Bundle state){super.onCreate(state);if(Build.VERSION.SDK_INT>=33){backCallback=this::handleBack;getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,backCallback);}showConnect("");AppUpdates.backgroundCheck(this);}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size,int color){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(color);v.setPadding(0,dp(8),0,dp(8));return v;}
    private Button button(String title,Runnable run){return NativeUi.button(this,title,run);}
    private void insets(View view){view.setOnApplyWindowInsetsListener((v,i)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars());v.setPadding(s.left,s.top,s.right,s.bottom);}else v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});}
    @Override protected void onPause(){if(web!=null){web.onPause();web.pauseTimers();}super.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null){web.resumeTimers();web.onResume();}}
    private void showConnect(String error){
        attempt++;if(web!=null){web.stopLoading();web.destroy();web=null;}hideVideo();
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(NativeUi.BG);insets(root);setContentView(root);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setGravity(Gravity.CENTER_HORIZONTAL);panel.setPadding(dp(22),dp(28),dp(22),dp(24));scroll.addView(panel,new ScrollView.LayoutParams(-1,-1));
        LinearLayout brand=new LinearLayout(this);brand.setGravity(Gravity.CENTER_VERTICAL);TextView mark=text("Z",24,Color.WHITE);mark.setGravity(Gravity.CENTER);mark.setTypeface(null,Typeface.BOLD);mark.setBackground(NativeUi.shape(this,NativeUi.ACCENT,16));LinearLayout.LayoutParams markSize=new LinearLayout.LayoutParams(dp(54),dp(54));markSize.setMargins(0,0,dp(14),0);brand.addView(mark,markSize);LinearLayout wordmark=new LinearLayout(this);wordmark.setOrientation(LinearLayout.VERTICAL);TextView logo=text("ZNote",26,Color.WHITE);logo.setTypeface(null,Typeface.BOLD);TextView tagline=text("你的私人多媒体知识库",13,NativeUi.MUTED);wordmark.addView(logo);wordmark.addView(tagline);brand.addView(wordmark);panel.addView(brand,new LinearLayout.LayoutParams(-1,-2));
        TextView heading=text("连接到你的知识库",21,NativeUi.TEXT);heading.setTypeface(null,Typeface.BOLD);LinearLayout.LayoutParams headingSpace=new LinearLayout.LayoutParams(-1,-2);headingSpace.setMargins(0,dp(30),0,dp(4));panel.addView(heading,headingSpace);TextView explanation=text("连接电脑或 NAS 上运行的 ZNote，手机采集内容会直接保存到你的服务器。",14,NativeUi.MUTED);panel.addView(explanation,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(16),dp(16),dp(16),dp(16));card.setBackground(NativeUi.shape(this,NativeUi.SURFACE,20));LinearLayout.LayoutParams cardSpace=new LinearLayout.LayoutParams(-1,-2);cardSpace.setMargins(0,dp(22),0,dp(12));panel.addView(card,cardSpace);
        TextView addressLabel=text("服务器地址",13,NativeUi.MUTED);addressLabel.setPadding(dp(2),0,0,dp(8));card.addView(addressLabel);
        EditText address=new EditText(this);address.setSingleLine(true);address.setTextSize(15);address.setTextColor(NativeUi.TEXT);address.setHintTextColor(0xff758098);address.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);address.setPadding(dp(14),dp(10),dp(14),dp(10));address.setBackground(NativeUi.shape(this,0xff171c29,13));address.setHint("http://192.168.1.10:3741");address.setText(getPreferences(0).getString("origin",""));card.addView(address,new LinearLayout.LayoutParams(-1,dp(54)));
        TextView status=text(error.isEmpty()?"手机与服务器需处于可互相访问的网络。":error,13,error.isEmpty()?NativeUi.MUTED:0xffffa995);status.setPadding(dp(2),dp(10),dp(2),dp(4));status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);card.addView(status);
        Button connect=button("连接并打开",()->{});NativeUi.primary(connect);LinearLayout.LayoutParams connectSpace=new LinearLayout.LayoutParams(-1,dp(50));connectSpace.setMargins(0,dp(12),0,0);card.addView(connect,connectSpace);connect.setOnClickListener(v->{final String target;try{target=normalize(address.getText().toString());}catch(Exception e){status.setText(e.getMessage());return;}connect.setEnabled(false);status.setText("正在连接…");int current=++attempt;network.execute(()->{String failure=null;try{HttpURLConnection c=(HttpURLConnection)new URL(target+"/api/health").openConnection();c.setConnectTimeout(6000);c.setReadTimeout(6000);c.setInstanceFollowRedirects(false);try{if(c.getResponseCode()!=200)throw new IOException();ByteArrayOutputStream buffer=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] block=new byte[512];int n;while(buffer.size()<=2048&&(n=in.read(block))!=-1)buffer.write(block,0,n);}byte[] bytes=buffer.toByteArray();if(bytes.length>2048)throw new IOException();JSONObject data=new JSONObject(new String(bytes,StandardCharsets.UTF_8));if(!"ok".equals(data.optString("status"))||data.optString("version").isEmpty())throw new IOException();}finally{c.disconnect();}}catch(Exception e){failure="连接失败：请检查地址、Wi‑Fi、服务器运行状态和防火墙。";}String result=failure;runOnUiThread(()->{if(current!=attempt||isFinishing())return;connect.setEnabled(true);if(result!=null)status.setText(result);else{getPreferences(0).edit().putString("origin",target).apply();open(target);}});});});
        LinearLayout secondary=new LinearLayout(this);secondary.setGravity(Gravity.CENTER);Button help=button("? 连接说明",()->new AlertDialog.Builder(this).setTitle("连接知识库").setMessage("输入电脑或 NAS 上的 ZNote 地址，访问密码在连接后填写。手机上的 localhost 不代表电脑；手机和服务器需要网络可达。客户端不包含整库离线副本。") .setPositiveButton("知道了",null).show());NativeUi.quiet(help);secondary.addView(help);Button update=button("检查更新",()->startActivity(new Intent(this,UpdateActivity.class)));NativeUi.quiet(update);secondary.addView(update);LinearLayout.LayoutParams secondarySpace=new LinearLayout.LayoutParams(-1,dp(48));secondarySpace.setMargins(0,dp(4),0,dp(8));panel.addView(secondary,secondarySpace);
        TextView footer=text("本地优先 · 内容保存在你自己的知识库",12,0xff78839b);footer.setGravity(Gravity.CENTER);panel.addView(footer,new LinearLayout.LayoutParams(-1,-2));
    }
    static String normalize(String input) throws Exception {
        String value=input.trim();URI u=new URI(value.contains("://")?value:"http://"+value);String scheme=u.getScheme(),host=u.getHost();
        if(host==null||!("http".equals(scheme)||"https".equals(scheme))||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||!(u.getPath().isEmpty()||u.getPath().equals("/")))throw new Exception("请填写知识库根地址，不要包含密码、路径或查询参数。");
        host=host.toLowerCase();boolean local=host.equals("localhost")||host.equals("[::1]")||(host.matches("[0-9]+(\\.[0-9]+){3}")&&host.matches("127\\..*|10\\..*|192\\.168\\..*|172\\.(1[6-9]|2[0-9]|3[01])\\..*"))||host.matches(".*\\.(local|lan|home\\.arpa)")||(!host.contains(".")&&!host.contains(":"))||host.matches("\\[?(fc|fd)[0-9a-f]{2}:.*|\\[?fe[89ab][0-9a-f]:.*");
        if(scheme.equals("http")&&!local)throw new Exception("公网地址请使用 HTTPS；HTTP 仅用于本机和局域网。");return scheme+"://"+u.getRawAuthority();
    }
    private boolean same(String value){try{Uri u=Uri.parse(value),base=Uri.parse(origin);return java.util.Objects.equals(u.getScheme(),base.getScheme())&&java.util.Objects.equals(u.getHost(),base.getHost())&&u.getPort()==base.getPort();}catch(Exception e){return false;}}
    private void external(String value){try{Uri u=Uri.parse(value);if(!java.util.Arrays.asList("http","https","mailto").contains(u.getScheme()))return;startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception e){Toast.makeText(this,"没有可打开此链接的应用",Toast.LENGTH_SHORT).show();}}
    private void open(String target){
        origin=target;root.removeAllViews();root.setBackgroundColor(Color.WHITE);
        LinearLayout toolbar=new LinearLayout(this);toolbar.setBackgroundColor(NativeUi.BG);toolbar.setGravity(Gravity.CENTER_VERTICAL);toolbar.setPadding(dp(8),0,dp(8),0);root.addView(toolbar,new LinearLayout.LayoutParams(-1,dp(48)));
        Button back=button("‹",this::handleBack);back.setContentDescription("返回上一层");back.setMinWidth(dp(40));back.setMinimumWidth(dp(40));NativeUi.quiet(back);toolbar.addView(back,new LinearLayout.LayoutParams(dp(44),-1));TextView title=text("ZNote",17,NativeUi.TEXT);toolbar.addView(title,new LinearLayout.LayoutParams(0,-2,1));toolbar.addView(button("采集",()->startActivity(new Intent(this,ShareActivity.class))));Button more=button("⋯",()->{});NativeUi.quiet(more);more.setContentDescription("更多选项");toolbar.addView(more,new LinearLayout.LayoutParams(dp(44),-1));more.setOnClickListener(v->{PopupMenu menu=new PopupMenu(this,more);menu.getMenu().add("刷新知识库").setOnMenuItemClickListener(item->{if(web!=null)web.evaluateJavascript("window.ZNoteNavigation?window.dispatchEvent(new Event('znote:refresh')):location.reload()",null);return true;});menu.getMenu().add("检查应用更新").setOnMenuItemClickListener(item->{startActivity(new Intent(this,UpdateActivity.class));return true;});menu.getMenu().add("采集设置").setOnMenuItemClickListener(item->{startActivity(new Intent(this,CaptureAssistActivity.class));return true;});menu.getMenu().add("切换连接").setOnMenuItemClickListener(item->{new AlertDialog.Builder(this).setMessage("切换前请保存当前编辑。").setNegativeButton("取消",null).setPositiveButton("切换",(d,w)->showConnect("")).show();return true;});menu.show();});
        web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setMediaPlaybackRequiresUserGesture(true);s.setSupportMultipleWindows(false);s.setUseWideViewPort(true);s.setLoadWithOverviewMode(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);web.addJavascriptInterface(new DraftDownload(),"ZNoteDownloads");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(same(request.getUrl().toString()))return false;if(request.isForMainFrame())external(request.getUrl().toString());return true;}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())Toast.makeText(MainActivity.this,"知识库连接中断，请检查网络或重新连接",Toast.LENGTH_LONG).show();}
            @Override public void onPageFinished(WebView view,String url){CookieManager.getInstance().flush();if(!same(url))return;view.evaluateJavascript("if(!window.__znoteDownloads){window.__znoteDownloads=true;document.addEventListener('click',async e=>{const a=e.target.closest?.('a[download]');if(!a||!a.href.startsWith('blob:')||!a.download.endsWith('.md'))return;e.preventDefault();try{const b=await(await fetch(a.href)).blob();if(b.size>2000000)return;ZNoteDownloads.markdown(a.download,await b.text())}catch{}},true)}",null);}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){if(!same(url)){result.cancel();return true;}new AlertDialog.Builder(MainActivity.this).setTitle("ZNote").setMessage(message).setPositiveButton("确定",(d,w)->result.confirm()).setNegativeButton("取消",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(chooser!=null)chooser.onReceiveValue(null);chooser=callback;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");String[] accept=params.getAcceptTypes();if(accept.length>0&&java.util.Arrays.stream(accept).allMatch(t->t.contains("/")))i.putExtra(Intent.EXTRA_MIME_TYPES,accept);i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);try{startActivityForResult(i,PICK);}catch(Exception e){chooser.onReceiveValue(null);chooser=null;}return true;}
            @Override public void onShowCustomView(View view,CustomViewCallback callback){if(fullScreen!=null){callback.onCustomViewHidden();return;}fullScreen=view;fullScreenCallback=callback;((android.widget.FrameLayout)getWindow().getDecorView()).addView(view,new android.widget.FrameLayout.LayoutParams(-1,-1));root.setVisibility(View.GONE);}
            @Override public void onHideCustomView(){hideVideo();}
            @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
        });
        web.setDownloadListener((url,ua,disposition,mime,length)->{if(!same(url)){if(!url.startsWith("blob:"))external(url);return;}try{DownloadManager.Request req=new DownloadManager.Request(Uri.parse(url));String cookie=CookieManager.getInstance().getCookie(url);if(cookie!=null)req.addRequestHeader("Cookie",cookie);req.addRequestHeader("User-Agent",ua);String filename=URLUtil.guessFileName(url,disposition,mime).replaceAll("[\\\\/:*?\"<>|]","_");req.setTitle(filename);if(mime!=null)req.setMimeType(mime);req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,filename);req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(req);Toast.makeText(this,"已加入系统下载，进度请查看通知",Toast.LENGTH_LONG).show();}catch(Exception e){Toast.makeText(this,"下载未开始，请用浏览器打开后重试",Toast.LENGTH_LONG).show();}});web.loadUrl(origin);
    }
    private class DraftDownload {
        @JavascriptInterface public void markdown(String name,String contents){if(contents==null||contents.length()>500000||name==null)return;runOnUiThread(()->{if(web==null||!same(web.getUrl())||draft!=null)return;draft=contents;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/markdown");String safe=name.replaceAll("[\\\\/:*?\"<>|]","_");i.putExtra(Intent.EXTRA_TITLE,safe.substring(0,Math.min(80,safe.length())).replaceAll("(?i)\\.md$","")+".md");try{startActivityForResult(i,SAVE);}catch(Exception e){draft=null;Toast.makeText(MainActivity.this,"无法打开保存窗口",Toast.LENGTH_SHORT).show();}});}
    }
    private void hideVideo(){if(fullScreen!=null){((android.view.ViewGroup)fullScreen.getParent()).removeView(fullScreen);fullScreen=null;if(root!=null)root.setVisibility(View.VISIBLE);if(fullScreenCallback!=null){fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;}}}
    void handleBack(){
        if(fullScreen!=null){hideVideo();return;}
        if(backBusy)return;
        final WebView current=web;
        if(current==null){moveTaskToBack(true);return;}
        if(!same(current.getUrl())){if(current.canGoBack())current.goBack();else showConnect("");return;}
        backBusy=true;
        current.evaluateJavascript("(()=>{if(window.ZNoteNavigation?.back)return window.ZNoteNavigation.back();const dialogs=[...document.querySelectorAll('[role=dialog]')];if(dialogs.length){(document.activeElement||dialogs.at(-1)).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;}return false;})()",handled->{
            backBusy=false;if(web!=current||isFinishing()||isDestroyed())return;
            if(!"true".equals(handled)){if(current.canGoBack())current.goBack();else moveTaskToBack(true);}
        });
    }
    @Override public void onBackPressed(){handleBack();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==PICK&&chooser!=null){Uri[] values=null;if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null){int n=data.getClipData().getItemCount();values=new Uri[n];for(int i=0;i<n;i++)values[i]=data.getClipData().getItemAt(i).getUri();}else if(data.getData()!=null)values=new Uri[]{data.getData()};}chooser.onReceiveValue(values);chooser=null;}if(request==SAVE){String text=draft;draft=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&text!=null)try(OutputStream out=getContentResolver().openOutputStream(data.getData())){out.write(text.getBytes(StandardCharsets.UTF_8));Toast.makeText(this,"Markdown 已保存",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"保存失败，原笔记仍保留",Toast.LENGTH_LONG).show();}}}
    @Override protected void onDestroy(){if(Build.VERSION.SDK_INT>=33&&backCallback!=null)getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);attempt++;network.shutdownNow();if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}if(web!=null)web.destroy();super.onDestroy();}
}
