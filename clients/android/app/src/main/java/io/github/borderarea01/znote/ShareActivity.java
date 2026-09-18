package io.github.borderarea01.znote;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.view.*;

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
    private String sessionCookie="";
    private String origin="",requestId=UUID.randomUUID().toString(),jobId="";
    private EditText text;
    private View emptyState;
    private Spinner collection;
    private Spinner imageMode;
    private TextView status;
    private Button save;
    private Button login;
    private boolean busy=false,visible=false,ready=false,completed=false,quickSave=false,autoShare=false;
    private boolean clipboardPending;
    private int clipboardAttempts;
    private final ClipboardManager.OnPrimaryClipChangedListener clipboardListener=()->{if(clipboardPending&&hasWindowFocus())handler.post(this::readClipboard);};
    private void timing(String event){String detail="launch_ms="+Math.max(0,SystemClock.elapsedRealtime()-getIntent().getLongExtra("panel_requested_at",SystemClock.elapsedRealtime()));if(CaptureAssistService.current!=null)CaptureAssistService.current.record(event,detail);else android.util.Log.i("ZNoteCapture",event+" "+detail);}
    private boolean floating(){return this instanceof FloatingShareActivity;}
    private void resizePanel(){if(floating()){WindowManager.LayoutParams p=getWindow().getAttributes();p.width=Math.min(dp(350),getResources().getDisplayMetrics().widthPixels-dp(24));p.height=Math.min(dp(quickSave?210:460),getResources().getDisplayMetrics().heightPixels-dp(100));p.x=0;p.y=0;getWindow().setAttributes(p);}}
    @Override public void onConfigurationChanged(android.content.res.Configuration c){super.onConfigurationChanged(c);resizePanel();}
    private int uploaded=0;
    private SharedPreferences preferences(){return getSharedPreferences("CaptureSharing",MODE_PRIVATE);}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private TextView label(String value,int size){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(0xffe7ebf5);v.setPadding(0,dp(floating()?6:12),0,dp(floating()?6:10));return v;}
    private Button button(String value,Runnable click){return NativeUi.button(this,value,click);}
    @Override public void onCreate(Bundle state){
        if(getIntent().getBooleanExtra("fresh_capture",false)){state=null;getIntent().removeExtra("fresh_capture");}super.onCreate(state);timing("panel_create");
        if(state!=null){requestId=state.getString("requestId",requestId);jobId=state.getString("jobId","");uploaded=state.getInt("uploaded",0);}
        Intent intent=getIntent();String shared=sharedText(intent);
        try{
            if(Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())){ArrayList<Uri> values=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);if(values!=null)for(Uri value:values)addFile(value);}
            else if(Intent.ACTION_SEND.equals(intent.getAction()))addFile(intent.getParcelableExtra(Intent.EXTRA_STREAM));
        }catch(Exception ignored){files.clear();}
        autoShare=state==null&&CaptureAssistService.current!=null&&CaptureAssistService.current.consumeDirectShare(intent,shared,!files.isEmpty());
        quickSave=(floating()&&intent.getBooleanExtra("quick_save",false))||autoShare;clipboardPending=floating()&&intent.getBooleanExtra("read_clipboard",false)&&state==null;
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(0xff161b28);root.setPadding(dp(24),dp(24),dp(24),dp(20));
        root.setOnApplyWindowInsetsListener((v,i)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars());v.setPadding(dp(24)+s.left,dp(24)+s.top,dp(24)+s.right,dp(20)+s.bottom);}return i;});
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(root);setContentView(scroll);
        if(floating()){
            root.setPadding(dp(18),dp(12),dp(18),dp(12));root.setOnApplyWindowInsetsListener(null);
            android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();bg.setColor(0xff191c27);bg.setCornerRadius(dp(20));bg.setStroke(dp(1),0xff424b66);root.setBackground(bg);
            resizePanel();
            getWindow().setGravity(Gravity.CENTER);setFinishOnTouchOutside(false);
        }
        TextView panelTitle=label(floating()?"⠿  保存这条作品":"保存到 ZNote",floating()?19:26);
        LinearLayout titleRow=new LinearLayout(this);titleRow.setGravity(Gravity.CENTER_VERTICAL);titleRow.addView(panelTitle,new LinearLayout.LayoutParams(0,-2,1));{Button close=button("×",this::finish);NativeUi.quiet(close);close.setContentDescription("收起采集面板");titleRow.addView(close,new LinearLayout.LayoutParams(dp(48),dp(48)));}root.addView(titleRow);
        if(floating())panelTitle.setOnTouchListener(new View.OnTouchListener(){float x,y;int ox,oy;public boolean onTouch(View v,android.view.MotionEvent e){WindowManager.LayoutParams p=getWindow().getAttributes();if(e.getActionMasked()==MotionEvent.ACTION_DOWN){x=e.getRawX();y=e.getRawY();ox=p.x;oy=p.y;return true;}if(e.getActionMasked()==MotionEvent.ACTION_MOVE){int maxX=Math.max(0,(getResources().getDisplayMetrics().widthPixels-p.width)/2),maxY=Math.max(0,(getResources().getDisplayMetrics().heightPixels-p.height)/2);p.x=Math.max(-maxX,Math.min(maxX,ox+(int)(e.getRawX()-x)));p.y=Math.max(-maxY,Math.min(maxY,oy+(int)(e.getRawY()-y)));getWindow().setAttributes(p);return true;}return true;}});
        LinearLayout heading=new LinearLayout(this);heading.setGravity(Gravity.CENTER_VERTICAL);
        if(floating())heading.addView(button(quickSave?"正在读取当前作品…":"读取剪贴板",()->{if(completed)nextCapture();getIntent().removeExtra("copied_after");getIntent().removeExtra("source_package");clipboardAttempts=0;clipboardPending=true;readClipboard();}),new LinearLayout.LayoutParams(0,dp(48),1));
        else heading.addView(label(files.isEmpty()?"分享链接":"已接收 "+files.size()+" 个媒体文件",15),new LinearLayout.LayoutParams(0,-2,1));
        Button help=button("?",()->new AlertDialog.Builder(this).setTitle("手机采集").setMessage("分享或粘贴一个作品链接，服务器负责下载正文、图片或视频。也可直接接收其他 App 分享的图片、视频，不用先存到相册。\n\n局域网保存需要手机能连接服务器。外出时可将链接发给微信 ClawBot，并在微信收件设置开启链接采集。平台要求登录或验证时，任务会保留失败原因。") .setPositiveButton("知道了",null).show());help.setContentDescription("手机采集说明");heading.addView(help,new LinearLayout.LayoutParams(dp(52),dp(48)));root.addView(heading);
        if(floating()&&shared.trim().isEmpty()&&files.isEmpty()&&!quickSave){
            LinearLayout empty=new LinearLayout(this);empty.setGravity(Gravity.CENTER_VERTICAL);empty.setPadding(dp(12),dp(10),dp(12),dp(10));empty.setBackground(NativeUi.shape(this,0xff20283a,16));
            TextView icon=label("↗",20);icon.setGravity(Gravity.CENTER);icon.setTextColor(0xffaebcff);icon.setBackground(NativeUi.shape(this,0xff303c5c,13));LinearLayout.LayoutParams iconParams=new LinearLayout.LayoutParams(dp(40),dp(40));iconParams.setMargins(0,0,dp(12),0);empty.addView(icon,iconParams);
            LinearLayout copy=new LinearLayout(this);copy.setOrientation(LinearLayout.VERTICAL);TextView title=label("链接还没带进来",14);title.setTypeface(null,android.graphics.Typeface.BOLD);TextView hint=label("可从剪贴板读取，或粘贴分享文字",12);hint.setTextColor(0xffaab4ca);copy.addView(title);copy.addView(hint);empty.addView(copy,new LinearLayout.LayoutParams(0,-2,1));LinearLayout.LayoutParams emptyParams=new LinearLayout.LayoutParams(-1,-2);emptyParams.setMargins(0,dp(6),0,dp(8));root.addView(empty,emptyParams);emptyState=empty;
        }
        text=new EditText(this);text.setTextColor(0xffe7ebf5);text.setHintTextColor(0xff929db5);text.setHint(files.isEmpty()?"作品链接或分享文案":"备注（可选）");text.setMinLines(floating()?2:3);text.setMaxLines(floating()?4:7);text.setPadding(dp(14),dp(12),dp(14),dp(12));text.setBackground(NativeUi.shape(this,0xff202532,14));text.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(16000)});text.setText(shared);root.addView(text);
        if(emptyState!=null)text.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){emptyState.setVisibility(s.toString().trim().isEmpty()?View.VISIBLE:View.GONE);}public void afterTextChanged(android.text.Editable e){}});
        root.addView(label("目标知识库",15));collection=new Spinner(this);root.addView(collection,new LinearLayout.LayoutParams(-1,dp(52)));
        if(files.isEmpty()){
            root.addView(label("图集保存方式",15));imageMode=new Spinner(this);
            ArrayAdapter<String> modes=new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,new String[]{"图片组 · 正文存备注","图文笔记 · 配图成组"}){@Override public View getView(int p,View v,ViewGroup parent){TextView label=(TextView)super.getView(p,v,parent);label.setTextColor(0xffe7ebf5);return label;}};modes.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);imageMode.setAdapter(modes);imageMode.setSelection(preferences().getBoolean("capture_as_note",false)?1:0);root.addView(imageMode,new LinearLayout.LayoutParams(-1,dp(48)));
        }
        save=button("保存到知识库",this::submit);NativeUi.primary(save);save.setEnabled(false);LinearLayout.LayoutParams saveSpace=new LinearLayout.LayoutParams(-1,dp(48));saveSpace.setMargins(0,dp(18),0,dp(6));root.addView(save,saveSpace);
        status=label(clipboardPending?"正在读取刚复制的分享链接…":floating()&&shared.trim().isEmpty()&&files.isEmpty()?"添加作品链接后即可保存":"正在连接知识库…",14);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);root.addView(status);

        login=button("打开知识库 / 登录",()->startActivity(new Intent(this,MainActivity.class)));root.addView(login);login.setVisibility(View.GONE);
    }
    @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(focused)timing("panel_focus");if(focused&&clipboardPending)handler.post(this::readClipboard);}
    private void readClipboard(){
        if(!hasWindowFocus()||!clipboardPending||isFinishing())return;
        try{
            ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            ClipDescription description=clipboard.getPrimaryClipDescription();
            long after=getIntent().getLongExtra("copied_after",0);
            ClipData clip=description!=null&&description.getTimestamp()>=after?clipboard.getPrimaryClip():null;
            CharSequence clipText=clip!=null&&clip.getItemCount()>0?clip.getItemAt(0).getText():null;
            String value=clipText!=null?clipText.toString():clip!=null&&clip.getItemCount()>0&&clip.getItemAt(0).getUri()!=null?clip.getItemAt(0).getUri().toString():"";
            String url=CaptureAssistService.link(value),owner=getIntent().getStringExtra("source_package");
            if(!url.isEmpty()&&CaptureAssistService.acceptsLink(owner,url)){
                clipboardPending=false;text.setText(value);status.setText(quickSave?"已读取，正在加入后台保存…":"已读取分享链接，确认知识库后保存");maybeQuickSave();return;
            }
        }catch(SecurityException ignored){}
        if(++clipboardAttempts<20){handler.postDelayed(this::readClipboard,200);return;}
        clipboardPending=false;status.setText("未读到本次分享链接，可直接在上方输入框长按粘贴");text.requestFocus();
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);intent.putExtra("fresh_capture",true);setIntent(intent);handler.removeCallbacksAndMessages(null);jobId="";requestId=UUID.randomUUID().toString();uploaded=0;busy=false;completed=false;recreate();}
    private void nextCapture(){if(!files.isEmpty()){onNewIntent(new Intent(this,getClass()));return;}handler.removeCallbacksAndMessages(null);jobId="";requestId=UUID.randomUUID().toString();uploaded=0;files.clear();busy=false;completed=false;collection.setEnabled(true);text.setEnabled(true);text.setText("");if(imageMode!=null)imageMode.setEnabled(true);save.setText("保存到知识库");save.setEnabled(ready);save.setOnClickListener(v->submit());status.setText("可粘贴下一条分享链接");}
    private String sharedText(Intent intent){
        LinkedHashSet<String> parts=new LinkedHashSet<>();for(String key:new String[]{Intent.EXTRA_TEXT,Intent.EXTRA_SUBJECT,Intent.EXTRA_TITLE}){CharSequence value=intent.getCharSequenceExtra(key);if(value!=null&&!value.toString().trim().isEmpty())parts.add(value.toString().trim());}
        ClipData clip=intent.getClipData();if(clip!=null)for(int i=0;i<clip.getItemCount();i++){CharSequence value=clip.getItemAt(i).getText();if(value!=null&&!value.toString().trim().isEmpty())parts.add(value.toString().trim());Uri uri=clip.getItemAt(i).getUri();if(uri!=null)addFile(uri);}
        return String.join("\n",parts);
    }
    private void maybeQuickSave(){if(quickSave&&ready&&!busy&&!completed&&(!files.isEmpty()||!text.getText().toString().trim().isEmpty()))submit();}
    private void saved(String message){busy=false;completed=true;status.setText(message);save.setText("继续采集");save.setEnabled(true);save.setOnClickListener(v->nextCapture());}
    private void addFile(Uri uri){if(uri!=null&&"content".equals(uri.getScheme())&&!files.contains(uri))files.add(uri);}
    @Override protected void onResume(){super.onResume();visible=true;((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).addPrimaryClipChangedListener(clipboardListener);if(!completed&&(!busy||!jobId.isEmpty()))loadCollections();}
    @Override protected void onPause(){visible=false;((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).removePrimaryClipChangedListener(clipboardListener);handler.removeCallbacksAndMessages(null);super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putString("requestId",requestId);state.putString("jobId",jobId);state.putInt("uploaded",uploaded);}
    private void ui(Runnable run){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())run.run();});}
    private void loadCollections(){
        worker.execute(()->{try{
            Bundle session=getContentResolver().call(Uri.parse("content://"+getPackageName()+".capture-session"),"session",null,null);
            if(session==null)throw new IOException("无法读取连接信息，请打开知识库登录");
            try{origin=MainActivity.normalize(session.getString("origin",""));}catch(Exception e){throw new IOException("先打开知识库，设置服务器地址并登录，再返回此页。分享内容仍在这里。");}
            sessionCookie=session.getString("cookie","");
            if(!preferences().contains("migrated"))preferences().edit().putBoolean("migrated",true).putString("share_collection",session.getString("share_collection","")).putBoolean("capture_as_note",session.getBoolean("capture_as_note",false)).apply();
            JSONObject result=request("GET","/api/collections",null);JSONArray rows=result.optJSONArray("collections");
            if(rows==null)throw new IOException("知识库列表格式不正确，请更新服务器");
            ArrayList<String> names=new ArrayList<>(),ids=new ArrayList<>();names.add("未分类");ids.add("");for(int i=0;i<rows.length();i++){JSONObject c=rows.getJSONObject(i);names.add(c.getString("name"));ids.add(c.getString("id"));}
            ui(()->{login.setVisibility(View.GONE);collectionIds.clear();collectionIds.addAll(ids);ArrayAdapter<String> adapter=new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,names){@Override public View getView(int p,View view,android.view.ViewGroup parent){TextView v=(TextView)super.getView(p,view,parent);v.setTextColor(0xffe7ebf5);return v;}};adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);collection.setAdapter(adapter);String requested=getIntent().hasExtra("selected_collection")?getIntent().getStringExtra("selected_collection"):preferences().getString("share_collection","");int at=ids.indexOf(requested==null?"":requested);collection.setSelection(Math.max(0,at));if(at<0)quickSave=false;if(imageMode!=null)imageMode.setSelection(preferences().getBoolean("capture_as_note",false)?1:0);ready=true;if(!jobId.isEmpty()){busy=true;save.setEnabled(false);poll();}else{save.setEnabled(true);status.setText(at<0?"上次的知识库已不存在，请重新选择":quickSave?"已连接，正在准备后台保存…":"已连接，保存后由服务器处理");maybeQuickSave();}});
        }catch(Exception e){ui(()->{login.setVisibility(View.VISIBLE);status.setText(e.getMessage());});}});
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
                JSONObject result=request("POST","/api/captures",input.toString());jobId=result.getString("id");ui(()->{if(floating()||autoShare){if(CaptureAssistService.current!=null)CaptureAssistService.current.backgroundQueued(jobId);Toast.makeText(this,"已加入后台保存，可继续浏览",Toast.LENGTH_SHORT).show();finish();}else poll();});
            }else{
                for(int i=uploaded;i<files.size();i++){final int index=i;ui(()->status.setText("正在上传 "+(index+1)+" / "+files.size()));upload(files.get(i),target,value,i);uploaded=i+1;}
                ui(()->{String message="已保存 "+files.size()+" 个媒体文件";if(autoShare){if(CaptureAssistService.current!=null)CaptureAssistService.current.directResult(true,message);Toast.makeText(this,message,Toast.LENGTH_SHORT).show();finish();}else saved(message+"，可返回原 App");});
            }
        }catch(Exception e){ui(()->{String message=(uploaded>0?"已保存 "+uploaded+" 个；":"")+e.getMessage();if(autoShare){if(CaptureAssistService.current!=null)CaptureAssistService.current.directResult(false,message);Toast.makeText(this,"采集失败，已发送通知",Toast.LENGTH_LONG).show();finish();return;}busy=false;save.setEnabled(true);collection.setEnabled(uploaded==0);text.setEnabled(uploaded==0);status.setText(message);});}});
    }
    private void poll(){
        if(!visible||jobId.isEmpty()||isDestroyed())return;
        final String trackedJob=jobId;worker.execute(()->{try{JSONObject job=request("GET","/api/captures/"+trackedJob,null);ui(()->{if(!trackedJob.equals(jobId)||completed)return;
            status.setText(job.optString("message"));String state=job.optString("status");
            if("completed".equals(state)){saved(job.optString("message","已保存到知识库"));}
            else if("failed".equals(state)){busy=false;save.setText("重试采集");save.setEnabled(true);save.setOnClickListener(v->{save.setEnabled(false);worker.execute(()->{try{request("POST","/api/captures/"+jobId+"/retry","{}");ui(()->{busy=true;poll();});}catch(Exception e){ui(()->{status.setText(e.getMessage());save.setEnabled(true);});}});});}
            else handler.postDelayed(this::poll,1500);
        });}catch(Exception e){ui(()->{if(!trackedJob.equals(jobId)||completed)return;status.setText("暂时无法读取任务状态，服务器可能仍在处理。正在重连…");handler.postDelayed(this::poll,5000);});}});
    }
    private HttpURLConnection connection(String method,String path)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(origin+path).openConnection();c.setRequestMethod(method);c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(30000);
        if(sessionCookie!=null&&!sessionCookie.isEmpty())c.setRequestProperty("Cookie",sessionCookie);return c;
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
    private long fileSize(Uri uri){try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.SIZE},null,null,null)){if(cursor!=null&&cursor.moveToFirst()&&!cursor.isNull(0))return cursor.getLong(0);}catch(Exception ignored){}return -1;}
    private void upload(Uri uri,String target,String note,int index)throws Exception{
        String mime=getContentResolver().getType(uri);if(mime==null||!(mime.startsWith("image/")||mime.startsWith("video/")))throw new IOException("分享内容不是可接收的图片或视频");
        boolean video=mime.startsWith("video/");long limit=(video?500L:100L)*1024*1024,known=fileSize(uri);if(known>limit)throw new IOException(video?"视频超过 500 MB":"图片超过 100 MB");String name="分享媒体 "+(index+1);
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
                try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("无法读取分享文件，请从原 App 重新分享");byte[] block=new byte[65536];long total=0;int n;while((n=in.read(block))!=-1){total+=n;if(total>limit)throw new IOException(video?"视频超过 500 MB":"图片超过 100 MB");out.write(block,0,n);}}
                out.write(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
            }response(c);
        }finally{c.disconnect();}
    }
    private void field(OutputStream out,String boundary,String name,String value)throws IOException{out.write(("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\"\r\n\r\n"+value+"\r\n").getBytes(StandardCharsets.UTF_8));}
    @Override protected void onDestroy(){handler.removeCallbacksAndMessages(null);worker.shutdown();super.onDestroy();}
}
