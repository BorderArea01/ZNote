package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.view.*;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Receives only the content explicitly granted by the Android share sheet. */
public class ShareActivity extends Activity {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ArrayList<Uri> files=new ArrayList<>();
    private final ArrayList<String> collectionIds=new ArrayList<>();
    private String origin="",requestId=UUID.randomUUID().toString(),jobId="";
    private EditText text;
    private Spinner collection;
    private Spinner imageMode;
    private TextView status;
    private Button save;
    private boolean busy=false,visible=false,ready=false;
    private int uploaded=0;
    private SharedPreferences preferences(){return getSharedPreferences("MainActivity",MODE_PRIVATE);}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private TextView label(String value,int size){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(0xffe7ebf5);v.setPadding(0,dp(12),0,dp(10));return v;}
    private Button button(String value,Runnable click){Button b=new Button(this);b.setText(value);b.setAllCaps(false);b.setOnClickListener(v->click.run());return b;}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        if(state!=null){requestId=state.getString("requestId",requestId);jobId=state.getString("jobId","");uploaded=state.getInt("uploaded",0);}
        Intent intent=getIntent();CharSequence extra=intent.getCharSequenceExtra(Intent.EXTRA_TEXT);String shared=extra==null?null:extra.toString();
        if(shared==null)shared="";
        try{
            if(Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())){ArrayList<Uri> values=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);if(values!=null)for(Uri value:values)addFile(value);}
            else if(Intent.ACTION_SEND.equals(intent.getAction()))addFile(intent.getParcelableExtra(Intent.EXTRA_STREAM));
        }catch(Exception ignored){files.clear();}
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(0xff161b28);root.setPadding(dp(24),dp(24),dp(24),dp(20));
        root.setOnApplyWindowInsetsListener((v,i)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars());v.setPadding(dp(24)+s.left,dp(24)+s.top,dp(24)+s.right,dp(20)+s.bottom);}return i;});
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(root);setContentView(scroll);
        root.addView(label("保存到 ZNote",26));
        LinearLayout heading=new LinearLayout(this);heading.setGravity(Gravity.CENTER_VERTICAL);heading.addView(label(files.isEmpty()?"分享链接":"已接收 "+files.size()+" 个媒体文件",15),new LinearLayout.LayoutParams(0,-2,1));
        Button help=button("?",()->new AlertDialog.Builder(this).setTitle("手机采集").setMessage("分享或粘贴一个作品链接，服务器负责下载正文、图片或视频。也可直接接收其他 App 分享的图片、视频，不用先存到相册。\n\n局域网保存需要手机能连接服务器。外出时可将链接发给微信 ClawBot，并在微信收件设置开启链接采集。平台要求登录或验证时，任务会保留失败原因。") .setPositiveButton("知道了",null).show());help.setContentDescription("手机采集说明");heading.addView(help,new LinearLayout.LayoutParams(dp(52),dp(48)));root.addView(heading);
        text=new EditText(this);text.setTextColor(0xffe7ebf5);text.setHintTextColor(0xffa1abc0);text.setHint(files.isEmpty()?"粘贴 App 分享文字或网页链接":"备注（可选）");text.setMinLines(3);text.setMaxLines(7);text.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(16000)});text.setText(shared);root.addView(text);
        root.addView(label("目标知识库",15));collection=new Spinner(this);root.addView(collection,new LinearLayout.LayoutParams(-1,dp(52)));
        if(files.isEmpty()){
            root.addView(label("图集保存方式",15));imageMode=new Spinner(this);
            ArrayAdapter<String> modes=new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,new String[]{"图片组 · 正文存备注","图文笔记 · 配图成组"}){@Override public View getView(int p,View v,ViewGroup parent){TextView label=(TextView)super.getView(p,v,parent);label.setTextColor(0xffe7ebf5);return label;}};modes.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);imageMode.setAdapter(modes);imageMode.setSelection(preferences().getBoolean("capture_as_note",false)?1:0);root.addView(imageMode,new LinearLayout.LayoutParams(-1,dp(48)));
        }
        save=button("保存到知识库",this::submit);save.setEnabled(false);root.addView(save);
        status=label("正在连接知识库…",14);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);
        root.addView(button("悬浮采集设置",()->startActivity(new Intent(this,CaptureAssistActivity.class))));
        root.addView(button("打开知识库 / 登录",()->startActivity(new Intent(this,MainActivity.class))));root.addView(button("返回原 App",this::finish));
    }
    private void addFile(Uri uri){if(uri!=null&&"content".equals(uri.getScheme())&&!files.contains(uri))files.add(uri);}
    @Override protected void onResume(){super.onResume();visible=true;if(!busy)loadCollections();else if(!jobId.isEmpty())poll();}
    @Override protected void onPause(){visible=false;handler.removeCallbacksAndMessages(null);super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putString("requestId",requestId);state.putString("jobId",jobId);state.putInt("uploaded",uploaded);}
    private void ui(Runnable run){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())run.run();});}
    private void loadCollections(){
        try{origin=MainActivity.normalize(preferences().getString("origin",""));}catch(Exception e){status.setText("先打开知识库，设置服务器地址并登录，再返回此页。分享内容仍在这里。");return;}
        worker.execute(()->{try{
            JSONObject result=request("GET","/api/collections",null);JSONArray rows=result.optJSONArray("collections");
            if(rows==null)throw new IOException("知识库列表格式不正确，请更新服务器");
            ArrayList<String> names=new ArrayList<>(),ids=new ArrayList<>();names.add("未分类");ids.add("");for(int i=0;i<rows.length();i++){JSONObject c=rows.getJSONObject(i);names.add(c.getString("name"));ids.add(c.getString("id"));}
            ui(()->{collectionIds.clear();collectionIds.addAll(ids);ArrayAdapter<String> adapter=new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,names){@Override public View getView(int p,View view,android.view.ViewGroup parent){TextView v=(TextView)super.getView(p,view,parent);v.setTextColor(0xffe7ebf5);return v;}};adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);collection.setAdapter(adapter);int at=ids.indexOf(preferences().getString("share_collection",""));collection.setSelection(Math.max(0,at));ready=true;if(!jobId.isEmpty()){busy=true;save.setEnabled(false);poll();}else{save.setEnabled(true);status.setText(at<0?"上次的知识库已不存在，请重新选择":"已连接，保存后由服务器处理");}});
        }catch(Exception e){ui(()->status.setText(e.getMessage()));}});
    }
    private void submit(){
        if(busy||!ready)return;
        if(files.size()>20){status.setText("一次最多分享 20 个媒体文件，请分批分享");return;}
        String value=text.getText().toString().trim();if(files.isEmpty()&&value.isEmpty()){status.setText("请粘贴一个作品链接");return;}
        int selected=collection.getSelectedItemPosition();if(selected<0||selected>=collectionIds.size())return;
        String target=collectionIds.get(selected);preferences().edit().putString("share_collection",target).apply();
        boolean asNote=imageMode!=null&&imageMode.getSelectedItemPosition()==1;preferences().edit().putBoolean("capture_as_note",asNote).apply();if(imageMode!=null)imageMode.setEnabled(false);
        busy=true;save.setEnabled(false);collection.setEnabled(false);text.setEnabled(false);status.setText("正在提交…");
        worker.execute(()->{try{
            if(files.isEmpty()){
                JSONObject input=new JSONObject().put("text",value).put("image_mode",asNote?"note":"group").put("collection_id",target.isEmpty()?JSONObject.NULL:target).put("request_id","android:"+requestId);
                JSONObject result=request("POST","/api/captures",input.toString());jobId=result.getString("id");ui(this::poll);
            }else{
                for(int i=uploaded;i<files.size();i++){final int index=i;ui(()->status.setText("正在上传 "+(index+1)+" / "+files.size()));upload(files.get(i),target,value,i);uploaded=i+1;}
                ui(()->{status.setText("已保存 "+files.size()+" 个媒体文件，可返回原 App");save.setText("已保存");});
            }
        }catch(Exception e){ui(()->{busy=false;save.setEnabled(true);collection.setEnabled(uploaded==0);text.setEnabled(uploaded==0);status.setText((uploaded>0?"已保存 "+uploaded+" 个；":"")+e.getMessage());});}});
    }
    private void poll(){
        if(!visible||jobId.isEmpty()||isDestroyed())return;
        worker.execute(()->{try{JSONObject job=request("GET","/api/captures/"+jobId,null);ui(()->{
            status.setText(job.optString("message"));String state=job.optString("status");
            if("completed".equals(state)){busy=false;save.setText("已保存");save.setEnabled(false);}
            else if("failed".equals(state)){busy=false;save.setText("重试采集");save.setEnabled(true);save.setOnClickListener(v->{save.setEnabled(false);worker.execute(()->{try{request("POST","/api/captures/"+jobId+"/retry","{}");ui(()->{busy=true;poll();});}catch(Exception e){ui(()->{status.setText(e.getMessage());save.setEnabled(true);});}});});}
            else handler.postDelayed(this::poll,1500);
        });}catch(Exception e){ui(()->{status.setText("暂时无法读取任务状态，服务器可能仍在处理。正在重连…");handler.postDelayed(this::poll,5000);});}});
    }
    private HttpURLConnection connection(String method,String path)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(origin+path).openConnection();c.setRequestMethod(method);c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(30000);
        String cookie=CookieManager.getInstance().getCookie(origin);if(cookie!=null)c.setRequestProperty("Cookie",cookie);return c;
    }
    private JSONObject response(HttpURLConnection c)throws Exception{
        int code=c.getResponseCode();InputStream stream=code>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        if(stream!=null)try(InputStream in=stream){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(bytes.size()+n>2*1024*1024)throw new IOException("服务器返回内容过大");bytes.write(b,0,n);}}
        String raw=bytes.toString("UTF-8");JSONObject result;
        try{result=raw.trim().startsWith("[")?new JSONObject().put("collections",new JSONArray(raw)):new JSONObject(raw);}catch(Exception e){throw new IOException("服务器响应异常，请检查连接或更新 ZNote");}
        if(code==401)throw new IOException("请先打开知识库登录，然后返回这里继续保存");
        if(code<200||code>=300)throw new IOException(result.optString("error","保存失败（HTTP "+code+"）"));return result;
    }
    private JSONObject request(String method,String path,String body)throws Exception{
        HttpURLConnection c=connection(method,path);try{if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}}return response(c);}finally{c.disconnect();}
    }
    private String fileName(Uri uri)throws Exception {try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst()&&cursor.getString(0)!=null)return cursor.getString(0);}return "手机分享";}
    private void upload(Uri uri,String target,String note,int index)throws Exception{
        String mime=getContentResolver().getType(uri);if(mime==null||!(mime.startsWith("image/")||mime.startsWith("video/")))throw new IOException("分享内容不是可接收的图片或视频");
        boolean video=mime.startsWith("video/");String name="分享媒体 "+(index+1);
        try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);}
        if(name==null||name.isEmpty())name="分享媒体";name=name.replaceAll("[\\r\\n\"\\\\]","_");if(name.length()>180)name=name.substring(0,180);
        String boundary="znote"+UUID.randomUUID().toString();HttpURLConnection c=connection("POST",video?"/api/videos":"/api/assets");
        try{c.setReadTimeout(120000);c.setDoOutput(true);c.setChunkedStreamingMode(65536);c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);
            try(OutputStream out=c.getOutputStream()){
                field(out,boundary,"title",name);field(out,boundary,"collection_id",target);field(out,boundary,"content",note);field(out,boundary,"tags","[]");
                java.util.regex.Matcher link=java.util.regex.Pattern.compile("https?://[^\\s<>\"]+").matcher(note);if(link.find()){String source=link.group().replaceAll("[，。；！、）】》,;!]+$", "");try{URI u=new URI(source);if(u.getHost()!=null&&u.getUserInfo()==null)field(out,boundary,"source_url",source);}catch(Exception ignored){}}
                long imageCount=files.stream().filter(v->{String type=getContentResolver().getType(v);return type!=null&&type.startsWith("image/");}).count();
                if(!video&&imageCount>1){field(out,boundary,"group_key","upload:"+requestId);String cover=fileName(files.stream().filter(v->{String type=getContentResolver().getType(v);return type!=null&&type.startsWith("image/");}).findFirst().get());field(out,boundary,"group_title",cover.substring(0,Math.min(180,cover.length())));field(out,boundary,"group_index",String.valueOf(index));}
                out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+name+"\"\r\nContent-Type: "+mime+"\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("无法读取分享文件，请从原 App 重新分享");byte[] block=new byte[65536];long total=0,limit=(video?500L:25L)*1024*1024;int n;while((n=in.read(block))!=-1){total+=n;if(total>limit)throw new IOException("媒体超过当前上传大小上限");out.write(block,0,n);}}
                out.write(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
            }response(c);
        }finally{c.disconnect();}
    }
    private void field(OutputStream out,String boundary,String name,String value)throws IOException{out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").getBytes(StandardCharsets.UTF_8));}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);worker.shutdown();super.onDestroy();}
}
