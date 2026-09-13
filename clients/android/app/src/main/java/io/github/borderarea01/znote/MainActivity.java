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
    private static final int PICK=20,SAVE=21;
    @Override public void onCreate(Bundle state){super.onCreate(state);showConnect("");}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size,int color){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(color);v.setPadding(0,dp(8),0,dp(8));return v;}
    private Button button(String title,Runnable run){Button b=new Button(this);b.setText(title);b.setAllCaps(false);b.setOnClickListener(v->run.run());return b;}
    private void insets(View view){view.setOnApplyWindowInsetsListener((v,i)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars());v.setPadding(s.left,s.top,s.right,s.bottom);}else v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i;});}
    private void showConnect(String error){
        attempt++;if(web!=null){web.stopLoading();web.destroy();web=null;}hideVideo();
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(20,25,38));insets(root);setContentView(root);
        ScrollView scroll=new ScrollView(this);root.addView(scroll);LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(dp(26),dp(34),dp(26),dp(26));scroll.addView(panel);
        TextView logo=text("ZNote",36,Color.WHITE);logo.setTypeface(null,Typeface.BOLD);panel.addView(logo);panel.addView(text("连接你的私人知识库",21,Color.rgb(220,227,246)));panel.addView(text("输入电脑或 NAS 上的 ZNote 地址。手机与服务器需网络可达；访问密码在连接后填写。",14,Color.rgb(180,193,216)));
        EditText address=new EditText(this);address.setSingleLine(true);address.setTextColor(Color.WHITE);address.setHintTextColor(Color.LTGRAY);address.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);address.setHint("http://192.168.1.10:3741");address.setText(getPreferences(0).getString("origin",""));panel.addView(address,new LinearLayout.LayoutParams(-1,dp(58)));
        TextView status=text(error,14,Color.rgb(245,187,167));
        Button connect=button("连接并打开",()->{});connect.setOnClickListener(v->{final String target;try{target=normalize(address.getText().toString());}catch(Exception e){status.setText(e.getMessage());return;}connect.setEnabled(false);status.setText("正在连接…");int current=++attempt;network.execute(()->{String failure=null;try{HttpURLConnection c=(HttpURLConnection)new URL(target+"/api/health").openConnection();c.setConnectTimeout(6000);c.setReadTimeout(6000);c.setInstanceFollowRedirects(false);try{if(c.getResponseCode()!=200)throw new IOException();ByteArrayOutputStream buffer=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] block=new byte[512];int n;while(buffer.size()<=2048&&(n=in.read(block))!=-1)buffer.write(block,0,n);}byte[] bytes=buffer.toByteArray();if(bytes.length>2048)throw new IOException();JSONObject data=new JSONObject(new String(bytes,StandardCharsets.UTF_8));if(!"ok".equals(data.optString("status"))||data.optString("version").isEmpty())throw new IOException();}finally{c.disconnect();}}catch(Exception e){failure="连接失败：请确认地址、Wi-Fi、服务器运行状态及防火墙。";}String result=failure;runOnUiThread(()->{if(current!=attempt||isFinishing())return;connect.setEnabled(true);if(result!=null)status.setText(result);else{getPreferences(0).edit().putString("origin",target).apply();open(target);}});});});panel.addView(connect);panel.addView(status);
        panel.addView(text("这是连接同一知识库的客户端，未连接时不保存整库离线副本。不要将其他设备的 localhost 当作服务器地址。",13,Color.rgb(160,174,198)));panel.addView(button("安装帮助与反馈 ↗",()->external("https://github.com/BorderArea01/ZNote/blob/main/docs/CLIENTS.md")));
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
        LinearLayout toolbar=new LinearLayout(this);toolbar.setGravity(Gravity.CENTER_VERTICAL);toolbar.setPadding(dp(8),0,dp(8),0);root.addView(toolbar,new LinearLayout.LayoutParams(-1,dp(48)));
        toolbar.addView(button("‹",()->{if(web.canGoBack())web.goBack();}));TextView title=text("ZNote",16,Color.rgb(35,45,62));toolbar.addView(title,new LinearLayout.LayoutParams(0,-2,1));toolbar.addView(button("连接",()->new AlertDialog.Builder(this).setMessage("切换前请保存当前编辑。").setNegativeButton("取消",null).setPositiveButton("切换",(d,w)->showConnect("")).show()));
        web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setMediaPlaybackRequiresUserGesture(true);s.setSupportMultipleWindows(false);s.setUseWideViewPort(true);s.setLoadWithOverviewMode(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);web.addJavascriptInterface(new DraftDownload(),"ZNoteDownloads");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(same(request.getUrl().toString()))return false;if(request.isForMainFrame())external(request.getUrl().toString());return true;}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())Toast.makeText(MainActivity.this,"知识库连接中断，请检查网络或重新连接",Toast.LENGTH_LONG).show();}
            @Override public void onPageFinished(WebView view,String url){CookieManager.getInstance().flush();if(!same(url))return;view.evaluateJavascript("if(!window.__znoteDownloads){window.__znoteDownloads=true;document.addEventListener('click',async e=>{const a=e.target.closest?.('a[download]');if(!a||!a.href.startsWith('blob:')||!a.download.endsWith('.md'))return;e.preventDefault();try{const b=await(await fetch(a.href)).blob();if(b.size>2000000)return;ZNoteDownloads.markdown(a.download,await b.text())}catch{}},true)}",null);}
        });
        web.setWebChromeClient(new WebChromeClient(){
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
    @Override public void onBackPressed(){if(fullScreen!=null){hideVideo();return;}if(web!=null&&web.canGoBack()){web.goBack();return;}super.onBackPressed();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==PICK&&chooser!=null){Uri[] values=null;if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null){int n=data.getClipData().getItemCount();values=new Uri[n];for(int i=0;i<n;i++)values[i]=data.getClipData().getItemAt(i).getUri();}else if(data.getData()!=null)values=new Uri[]{data.getData()};}chooser.onReceiveValue(values);chooser=null;}if(request==SAVE){String text=draft;draft=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&text!=null)try(OutputStream out=getContentResolver().openOutputStream(data.getData())){out.write(text.getBytes(StandardCharsets.UTF_8));Toast.makeText(this,"Markdown 已保存",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"保存失败，原笔记仍保留",Toast.LENGTH_LONG).show();}}}
    @Override protected void onDestroy(){attempt++;network.shutdownNow();if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}if(web!=null)web.destroy();super.onDestroy();}
}
