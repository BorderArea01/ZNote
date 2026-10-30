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
    static volatile boolean captureVisible;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ArrayList<Uri> files=new ArrayList<>();
    private final ArrayList<String> collectionIds=new ArrayList<>();
    private String sessionCookie="",sessionToken="";
    private String origin="",submissionOrigin="",routeLabel="",requestId=UUID.randomUUID().toString(),jobId="";
    private EditText text;
    private View emptyState;
    private Spinner collection;
    private Spinner imageMode;
    private TextView status;
    private Button save;
    private Button login;
    private Button pixivLogin;
    private static final class PixivLoginRequired extends IOException{PixivLoginRequired(String message){super(message);}}
    private View modeSection,linkHeading;
    private boolean keyboardOpen;
    private boolean busy=false,visible=false,ready=false,completed=false,quickSave=false,autoShare=false;
    private boolean clipboardPending,clipboardFeedback;
    private int clipboardAttempts;
    private final ClipboardManager.OnPrimaryClipChangedListener clipboardListener=()->{if(clipboardPending&&hasWindowFocus())handler.post(this::readClipboard);};
    private void timing(String event){String detail="launch_ms="+Math.max(0,SystemClock.elapsedRealtime()-getIntent().getLongExtra("panel_requested_at",SystemClock.elapsedRealtime()));if(CaptureAssistService.current!=null)CaptureAssistService.current.record(event,detail);else android.util.Log.i("ZNoteCapture",event+" "+detail);}
    private boolean floating(){return this instanceof FloatingShareActivity;}
    private void resizePanel(){if(floating()){WindowManager.LayoutParams p=getWindow().getAttributes();p.width=Math.min(dp(316),getResources().getDisplayMetrics().widthPixels-dp(24));p.height=WindowManager.LayoutParams.WRAP_CONTENT;p.x=0;p.y=0;getWindow().setAttributes(p);}}
    @Override public void onConfigurationChanged(android.content.res.Configuration c){super.onConfigurationChanged(c);resizePanel();}
    private int uploaded=0;
    private SharedPreferences preferences(){return getSharedPreferences("CaptureSharing",MODE_PRIVATE);}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private TextView label(String value,int size){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(CaptureVisuals.INK);v.setPadding(0,dp(floating()?6:12),0,dp(floating()?6:10));return v;}
    private Button button(String value,Runnable click){return NativeUi.button(this,value,click);}
    private ArrayAdapter<String> choices(List<String> values){
        return new ArrayAdapter<String>(this,android.R.layout.simple_spinner_item,values){
            @Override public View getView(int p,View v,ViewGroup parent){TextView t=(TextView)super.getView(p,v,parent);t.setTextColor(CaptureVisuals.INK);t.setTextSize(13);t.setSingleLine(true);t.setEllipsize(android.text.TextUtils.TruncateAt.END);t.setPadding(0,0,dp(6),0);return t;}
            @Override public View getDropDownView(int p,View v,ViewGroup parent){TextView t=(TextView)super.getDropDownView(p,v,parent);t.setTextColor(CaptureVisuals.INK);t.setTextSize(14);t.setPadding(dp(16),dp(12),dp(16),dp(12));t.setMinHeight(dp(48));t.setBackgroundColor(CaptureVisuals.FIELD);return t;}
        };
    }
    private View picker(LinearLayout root,String title,Spinner spinner){
        LinearLayout section=new LinearLayout(this);section.setOrientation(LinearLayout.VERTICAL);root.addView(section);
        TextView heading=label(title,12);heading.setTextColor(CaptureVisuals.MUTED);heading.setPadding(dp(2),dp(14),0,dp(6));section.addView(heading);
        LinearLayout field=new LinearLayout(this);field.setGravity(Gravity.CENTER_VERTICAL);field.setPadding(dp(12),0,dp(12),0);field.setBackground(NativeUi.shape(this,CaptureVisuals.FIELD,10));
        spinner.setBackground(null);spinner.setPopupBackgroundDrawable(NativeUi.shape(this,CaptureVisuals.FIELD,10));field.addView(spinner,new LinearLayout.LayoutParams(0,dp(44),1));
        View arrow=new View(this);arrow.setBackground(CaptureVisuals.icon(this,"down",CaptureVisuals.MUTED,14));arrow.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);arrow.setOnClickListener(v->spinner.performClick());field.addView(arrow,new LinearLayout.LayoutParams(dp(14),dp(14)));section.addView(field);
        spinner.setContentDescription(title);
        return section;
    }
    private void keyboard(boolean open){
        if(!floating()||text==null||keyboardOpen==open)return;keyboardOpen=open;
        if(modeSection!=null)modeSection.setVisibility(open?View.GONE:View.VISIBLE);
        if(linkHeading!=null)linkHeading.setVisibility(open?View.GONE:View.VISIBLE);
        text.setMinLines(open?1:2);text.setMaxLines(open?2:4);
        if(status!=null){status.setMaxLines(open?2:3);status.setEllipsize(open?android.text.TextUtils.TruncateAt.END:null);}
    }
    @Override public void onCreate(Bundle state){
        if(getIntent().getBooleanExtra("fresh_capture",false)){state=null;getIntent().removeExtra("fresh_capture");}super.onCreate(state);NativeAppearance.load(this);NativeAppearance.window(this);timing("panel_create");
        if(state!=null){requestId=state.getString("requestId",requestId);jobId=state.getString("jobId","");submissionOrigin=state.getString("submissionOrigin","");uploaded=state.getInt("uploaded",0);}
        Intent intent=getIntent();String shared=sharedText(intent);
        try{
            if(Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())){ArrayList<Uri> values=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);if(values!=null)for(Uri value:values)addFile(value);}
            else if(Intent.ACTION_SEND.equals(intent.getAction()))addFile(intent.getParcelableExtra(Intent.EXTRA_STREAM));
        }catch(Exception ignored){files.clear();}
        autoShare=state==null&&CaptureAssistService.current!=null&&CaptureAssistService.current.consumeDirectShare(intent,shared,!files.isEmpty());
        quickSave=(floating()&&intent.getBooleanExtra("quick_save",false))||autoShare;clipboardPending=floating()&&intent.getBooleanExtra("read_clipboard",false)&&state==null;
        LinearLayout chrome=new LinearLayout(this){@Override protected void onMeasure(int w,int h){if(floating()){int available=getResources().getDisplayMetrics().heightPixels-dp(72);if(View.MeasureSpec.getMode(h)!=View.MeasureSpec.UNSPECIFIED)available=Math.min(available,View.MeasureSpec.getSize(h));h=View.MeasureSpec.makeMeasureSpec(Math.max(1,available),View.MeasureSpec.AT_MOST);}super.onMeasure(w,h);}};
        chrome.setOrientation(LinearLayout.VERTICAL);chrome.setBackground(NativeAppearance.glitch?NativeAppearance.panel(this,0):NativeUi.shape(this,0xff161b28,0));chrome.setPadding(dp(24),dp(24),dp(24),dp(20));
        chrome.setOnApplyWindowInsetsListener((v,i)->{if(Build.VERSION.SDK_INT>=30&&!floating()){android.graphics.Insets s=i.getInsets(WindowInsets.Type.systemBars());v.setPadding(dp(24)+s.left,dp(24)+s.top,dp(24)+s.right,dp(20)+s.bottom);}return i;});
        // Only the form scrolls. Window resizing for the IME must keep the
        // header and footer outside that scroll area, with save always visible.
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.addView(root);setContentView(chrome);
        if(floating()){
            chrome.setPadding(dp(15),dp(8),dp(15),dp(10));
            android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();bg.setColor(CaptureVisuals.SURFACE);bg.setCornerRadius(dp(20));bg.setStroke(dp(1),CaptureVisuals.BORDER);chrome.setBackground(NativeAppearance.glitch?NativeAppearance.panel(this,12):bg);chrome.setClipToOutline(true);
            resizePanel();
            getWindow().setGravity(Gravity.CENTER);setFinishOnTouchOutside(false);
        }
        TextView panelTitle=label("保存到 ZNote",floating()?14:26);panelTitle.setTypeface(null,android.graphics.Typeface.BOLD);panelTitle.setCompoundDrawablesWithIntrinsicBounds(CaptureVisuals.icon(this,"z",NativeAppearance.glitch?CaptureVisuals.ACCENT:0xffa3b6a8,20),null,null,null);panelTitle.setCompoundDrawablePadding(dp(8));
        LinearLayout titleRow=new LinearLayout(this);titleRow.setGravity(Gravity.CENTER_VERTICAL);titleRow.addView(panelTitle,new LinearLayout.LayoutParams(0,-2,1));
        {Button close=button("",this::finish);CaptureVisuals.action(close,"close",false);close.setPadding(dp(14),0,dp(14),0);close.setContentDescription("收起采集面板");titleRow.addView(close,new LinearLayout.LayoutParams(dp(44),dp(44)));}chrome.addView(titleRow);chrome.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        if(floating())panelTitle.setOnTouchListener(new View.OnTouchListener(){float x,y;int ox,oy;public boolean onTouch(View v,android.view.MotionEvent e){WindowManager.LayoutParams p=getWindow().getAttributes();if(e.getActionMasked()==MotionEvent.ACTION_DOWN){x=e.getRawX();y=e.getRawY();ox=p.x;oy=p.y;return true;}if(e.getActionMasked()==MotionEvent.ACTION_MOVE){int maxX=Math.max(0,(getResources().getDisplayMetrics().widthPixels-getWindow().getDecorView().getWidth())/2-dp(12)),maxY=Math.max(0,(getResources().getDisplayMetrics().heightPixels-getWindow().getDecorView().getHeight())/2-dp(24));p.x=Math.max(-maxX,Math.min(maxX,ox+(int)(e.getRawX()-x)));p.y=Math.max(-maxY,Math.min(maxY,oy+(int)(e.getRawY()-y)));getWindow().setAttributes(p);return true;}return true;}});
        LinearLayout heading=new LinearLayout(this);heading.setGravity(Gravity.CENTER_VERTICAL);LinearLayout.LayoutParams headingSpace=new LinearLayout.LayoutParams(-1,-2);headingSpace.setMargins(0,dp(8),0,dp(4));
        heading.addView(label(files.isEmpty()?"作品链接":"已接收 "+files.size()+" 个媒体文件",12),new LinearLayout.LayoutParams(0,-2,1));
        Button help=button("",()->new AlertDialog.Builder(this).setTitle("手机采集").setMessage("在任意 App 可用系统分享菜单，把链接、图片或视频直接发给 ZNote；悬浮入口也会尝试读取当前作品的分享链接。服务器负责下载正文、图片或视频。B 站图文动态（b23.tv 或 /opus/ 链接）会保存标题、正文、话题和配图。\n\n局域网保存需要手机能连接服务器。外出时可将链接发给微信 ClawBot，并在微信收件设置开启链接采集。平台要求登录或验证时，任务会保留失败原因。") .setPositiveButton("知道了",null).show());CaptureVisuals.action(help,"help",false);help.setPadding(dp(14),0,dp(14),0);help.setContentDescription("手机采集说明");heading.addView(help,new LinearLayout.LayoutParams(dp(44),dp(44)));root.addView(heading,headingSpace);linkHeading=heading;
        if(!floating()&&shared.trim().isEmpty()&&files.isEmpty()&&!quickSave){
            LinearLayout empty=new LinearLayout(this);empty.setGravity(Gravity.CENTER_VERTICAL);empty.setPadding(dp(12),dp(10),dp(12),dp(10));empty.setBackground(NativeUi.shape(this,CaptureVisuals.FIELD,16));
            TextView icon=label("↗",20);icon.setGravity(Gravity.CENTER);icon.setTextColor(0xffaebcff);icon.setBackground(NativeUi.shape(this,CaptureVisuals.SURFACE,13));LinearLayout.LayoutParams iconParams=new LinearLayout.LayoutParams(dp(40),dp(40));iconParams.setMargins(0,0,dp(12),0);empty.addView(icon,iconParams);
            LinearLayout copy=new LinearLayout(this);copy.setOrientation(LinearLayout.VERTICAL);TextView title=label("链接还没带进来",14);title.setTypeface(null,android.graphics.Typeface.BOLD);TextView hint=label("也可从任意 App 的分享菜单直接发送",12);hint.setTextColor(CaptureVisuals.MUTED);copy.addView(title);copy.addView(hint);empty.addView(copy,new LinearLayout.LayoutParams(0,-2,1));LinearLayout.LayoutParams emptyParams=new LinearLayout.LayoutParams(-1,-2);emptyParams.setMargins(0,dp(6),0,dp(8));root.addView(empty,emptyParams);emptyState=empty;
        }
        text=new EditText(this);text.setTextSize(14);text.setTextColor(CaptureVisuals.INK);text.setHintTextColor(CaptureVisuals.MUTED);text.setHint(files.isEmpty()?"作品链接或分享文案":"备注（可选）");text.setMinLines(floating()?2:3);text.setMaxLines(floating()?4:7);text.setGravity(Gravity.TOP|Gravity.START);text.setPadding(dp(12),dp(12),dp(12),dp(12));text.setBackgroundTintList(null);text.setBackground(NativeUi.shape(this,CaptureVisuals.FIELD,10));text.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(16000)});text.setTextIsSelectable(true);text.setLongClickable(true);text.setText(shared);root.addView(text);
        if(emptyState!=null)text.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){emptyState.setVisibility(s.toString().trim().isEmpty()?View.VISIBLE:View.GONE);}public void afterTextChanged(android.text.Editable e){}});
        collection=new Spinner(this,Spinner.MODE_DROPDOWN);collection.setAdapter(choices(Collections.singletonList("正在读取知识库…")));collection.setEnabled(false);picker(root,"目标知识库",collection);
        if(files.isEmpty()){
            imageMode=new Spinner(this,Spinner.MODE_DROPDOWN);
            ArrayAdapter<String> modes=choices(Arrays.asList("图片组 · 正文存备注","图文笔记 · 配图成组"));modes.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);imageMode.setAdapter(modes);imageMode.setSelection(preferences().getBoolean("capture_as_note",false)?1:0);modeSection=picker(root,"图集保存方式",imageMode);
        }
        save=button("保存到知识库",this::submit);CaptureVisuals.action(save,"capture",true);save.setEnabled(false);LinearLayout.LayoutParams saveSpace=new LinearLayout.LayoutParams(-1,dp(48));saveSpace.setMargins(0,dp(16),0,dp(4));chrome.addView(save,saveSpace);
        LinearLayout actions=new LinearLayout(this);actions.setGravity(Gravity.CENTER_VERTICAL);
        Button clipboard=button("读取剪贴板",()->{if(completed)nextCapture();getIntent().removeExtra("copied_after");getIntent().removeExtra("source_package");clipboardAttempts=0;clipboardPending=true;clipboardFeedback=false;status.setText("正在读取剪贴板…");readClipboard();});CaptureVisuals.action(clipboard,"paste",false);clipboard.setTextSize(11);clipboard.setPadding(dp(6),0,dp(4),0);actions.addView(clipboard,new LinearLayout.LayoutParams(0,dp(48),1));
        View divider=new View(this);divider.setBackgroundColor(0xff3b465a);actions.addView(divider,new LinearLayout.LayoutParams(dp(1),dp(20)));
        Button browse=button("前往知识库",this::openLibrary);CaptureVisuals.action(browse,"folder",false);browse.setTextSize(11);browse.setPadding(dp(6),0,dp(4),0);browse.setContentDescription("打开 ZNote 浏览知识库");actions.addView(browse,new LinearLayout.LayoutParams(0,dp(48),1));chrome.addView(actions);
        status=label(clipboardPending?"正在读取刚复制的分享链接…":floating()&&shared.trim().isEmpty()&&files.isEmpty()?"添加作品链接后即可保存":"正在连接知识库…",12);status.setTextColor(CaptureVisuals.MUTED);status.setMaxLines(3);status.setMovementMethod(android.text.method.ScrollingMovementMethod.getInstance());status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);chrome.addView(status);

        login=button("打开知识库 / 登录",()->startActivity(new Intent(this,MainActivity.class)));CaptureVisuals.action(login,"folder",false);chrome.addView(login);login.setVisibility(View.GONE);
        pixivLogin=button("登录 Pixiv",()->{quickSave=false;startActivityForResult(new Intent(this,PixivLoginActivity.class).putExtra("active_capture",true),61);});CaptureVisuals.action(pixivLogin,"folder",false);chrome.addView(pixivLogin);pixivLogin.setVisibility(PixivSession.work(CaptureAssistService.link(shared)).isEmpty()?View.GONE:View.VISIBLE);
        text.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int b,int c){}public void onTextChanged(CharSequence s,int a,int b,int c){pixivLogin.setVisibility(PixivSession.work(CaptureAssistService.link(s.toString())).isEmpty()?View.GONE:View.VISIBLE);}public void afterTextChanged(android.text.Editable e){}});
        if(floating())chrome.getViewTreeObserver().addOnGlobalLayoutListener(()->{
            // Legacy floating Dialog windows may resize without reporting
            // Type.ime visibility, even on API 30+. Use their visible frame too.
            android.graphics.Rect available=new android.graphics.Rect();View decor=getWindow().getDecorView();decor.getWindowVisibleDisplayFrame(available);
            WindowInsets insets=decor.getRootWindowInsets();boolean ime=Build.VERSION.SDK_INT>=30&&insets!=null&&insets.isVisible(WindowInsets.Type.ime());
            keyboard(ime||getResources().getDisplayMetrics().heightPixels-available.bottom>dp(180));
        });
    }
    private void openLibrary(){startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP));}
    @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);if(code==61){quickSave=false;if(pixivLogin!=null)pixivLogin.setText(result==RESULT_OK?"管理 Pixiv 登录":"登录 Pixiv");if(status!=null)status.setText(result==RESULT_OK?"Pixiv 登录状态已保存在手机，可继续保存当前作品":"已返回，作品链接仍保留");}}
    @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(focused)timing("panel_focus");if(focused&&clipboardPending)handler.post(this::readClipboard);}
    private void readClipboard(){
        if(!hasWindowFocus()||!clipboardPending||isFinishing())return;
        try{
            ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
            ClipDescription description=clipboard.getPrimaryClipDescription();
            boolean copyPrompt=getIntent().getBooleanExtra("copy_prompt",false);
            if(copyPrompt&&description!=null&&description.getExtras()!=null&&description.getExtras().getBoolean("android.content.extra.IS_SENSITIVE",false)){clipboardPending=false;status.setText("内容标记为敏感，请手动粘贴确认");return;}
            long after=getIntent().getLongExtra("copied_after",0);
            ClipData clip=description!=null&&description.getTimestamp()>=after?clipboard.getPrimaryClip():null;
            CharSequence clipText=clip!=null&&clip.getItemCount()>0?clip.getItemAt(0).getText():null;
            String value=clipText!=null?clipText.toString():clip!=null&&clip.getItemCount()>0&&clip.getItemAt(0).getUri()!=null?clip.getItemAt(0).getUri().toString():"";
            String url=CaptureAssistService.link(value),owner=copyPrompt?"":getIntent().getStringExtra("source_package");
            if(!url.isEmpty()&&CaptureAssistService.acceptsLink(owner,url)){
                clipboardPending=false;clipboardFeedback=true;text.setText(value);status.setText(quickSave?"已读取，正在加入后台保存…":"已读取分享链接，确认知识库后保存");maybeQuickSave();return;
            }
        }catch(SecurityException ignored){}
        if(++clipboardAttempts<20){handler.postDelayed(this::readClipboard,200);return;}
        clipboardPending=false;clipboardFeedback=true;status.setText("未读到本次分享链接，可直接在上方输入框长按粘贴");text.requestFocus();
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);intent.putExtra("fresh_capture",true);setIntent(intent);handler.removeCallbacksAndMessages(null);jobId="";submissionOrigin="";requestId=UUID.randomUUID().toString();uploaded=0;busy=false;completed=false;recreate();}
    private void nextCapture(){if(!files.isEmpty()){onNewIntent(new Intent(this,getClass()));return;}handler.removeCallbacksAndMessages(null);jobId="";submissionOrigin="";requestId=UUID.randomUUID().toString();uploaded=0;files.clear();busy=false;completed=false;collection.setEnabled(true);text.setEnabled(true);text.setText("");if(imageMode!=null)imageMode.setEnabled(true);save.setText("保存到知识库");save.setEnabled(ready);save.setOnClickListener(v->submit());status.setText("可粘贴下一条分享链接");}
    private String sharedText(Intent intent){
        LinkedHashSet<String> parts=new LinkedHashSet<>();for(String key:new String[]{Intent.EXTRA_TEXT,Intent.EXTRA_SUBJECT,Intent.EXTRA_TITLE}){CharSequence value=intent.getCharSequenceExtra(key);if(value!=null&&!value.toString().trim().isEmpty())parts.add(value.toString().trim());}
        ClipData clip=intent.getClipData();if(clip!=null)for(int i=0;i<clip.getItemCount();i++){CharSequence value=clip.getItemAt(i).getText();if(value!=null&&!value.toString().trim().isEmpty())parts.add(value.toString().trim());Uri uri=clip.getItemAt(i).getUri();if(uri!=null)addFile(uri);}
        return String.join("\n",parts);
    }
    private void maybeQuickSave(){if(quickSave&&ready&&!busy&&!completed&&(!files.isEmpty()||!text.getText().toString().trim().isEmpty()))submit();}
    private void saved(String message){busy=false;completed=true;status.setText(message);save.setText("继续采集");save.setEnabled(true);save.setOnClickListener(v->nextCapture());}
    private void addFile(Uri uri){if(uri!=null&&"content".equals(uri.getScheme())&&!files.contains(uri))files.add(uri);}
    @Override protected void onResume(){super.onResume();visible=true;captureVisible=true;((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).addPrimaryClipChangedListener(clipboardListener);if(!completed&&(!busy||!jobId.isEmpty()))loadCollections();}
    @Override protected void onPause(){visible=false;captureVisible=false;((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).removePrimaryClipChangedListener(clipboardListener);handler.removeCallbacksAndMessages(null);super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putString("requestId",requestId);state.putString("jobId",jobId);state.putString("submissionOrigin",submissionOrigin);state.putInt("uploaded",uploaded);}
    private void ui(Runnable run){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())run.run();});}
    private void loadCollections(){
        worker.execute(()->{try{
            Bundle options=new Bundle();options.putBoolean("local_only",!files.isEmpty());
            Bundle session=getContentResolver().call(Uri.parse("content://"+getPackageName()+".capture-session"),"session",submissionOrigin,options);
            if(session==null)throw new IOException("无法读取连接信息，请打开知识库登录");
            try{origin=MainActivity.normalize(session.getString("origin",""));}catch(Exception e){throw new IOException(files.isEmpty()?"先打开知识库，设置服务器地址并登录，再返回此页。分享内容仍在这里。":"媒体上传需要局域网连接；远程入口只接收作品链接");}
            sessionCookie=session.getString("cookie","");sessionToken=session.getString("token","");
            routeLabel="lan".equals(session.getString("route"))?"局域网直连":"remote".equals(session.getString("route"))?"远程采集":"已连接";
            if(!preferences().contains("migrated"))preferences().edit().putBoolean("migrated",true).putString("share_collection",session.getString("share_collection","")).putBoolean("capture_as_note",session.getBoolean("capture_as_note",false)).apply();
            JSONObject result=request("GET","/api/collections",null);JSONArray rows=result.optJSONArray("collections");
            if(rows==null)throw new IOException("知识库列表格式不正确，请更新服务器");
            ArrayList<String> names=new ArrayList<>(),ids=new ArrayList<>();names.add("未分类");ids.add("");for(int i=0;i<rows.length();i++){JSONObject c=rows.getJSONObject(i);names.add(c.getString("name"));ids.add(c.getString("id"));}
            ui(()->{login.setVisibility(View.GONE);collectionIds.clear();collectionIds.addAll(ids);ArrayAdapter<String> adapter=choices(names);adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);collection.setAdapter(adapter);collection.setEnabled(!busy);String requested=getIntent().hasExtra("selected_collection")?getIntent().getStringExtra("selected_collection"):preferences().getString("share_collection","");int at=ids.indexOf(requested==null?"":requested);collection.setSelection(Math.max(0,at));if(at<0)quickSave=false;if(imageMode!=null)imageMode.setSelection(preferences().getBoolean("capture_as_note",false)?1:0);ready=true;if(!jobId.isEmpty()){busy=true;save.setEnabled(false);poll();}else{save.setEnabled(true);if(!clipboardFeedback)status.setText(clipboardPending?"正在读取刚复制的分享链接…":at<0?"上次的知识库已不存在，请重新选择":quickSave?"已连接，正在准备后台保存…":"已连接 · "+routeLabel+"，保存后由服务器处理");maybeQuickSave();}});
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
            // Select again immediately before the first write. Never fall back
            // after a write may have arrived: the two queues have different IDs.
            if(submissionOrigin.isEmpty()){
                Bundle options=new Bundle();options.putBoolean("local_only",!files.isEmpty());
                Bundle chosen=getContentResolver().call(Uri.parse("content://"+getPackageName()+".capture-session"),"session",null,options);
                if(chosen==null||chosen.getString("origin","").isEmpty())throw new IOException("媒体上传需要局域网连接；远程入口只接收作品链接");
                origin=MainActivity.normalize(chosen.getString("origin"));sessionCookie=chosen.getString("cookie","");sessionToken=chosen.getString("token","");submissionOrigin=origin;
            }
            if(files.isEmpty()){
                JSONObject input=new JSONObject().put("text",value).put("image_mode",asNote?"note":"group").put("collection_id",target.isEmpty()?JSONObject.NULL:target).put("request_id","android:"+requestId);
                String workUrl=CaptureAssistService.link(value);
                if(!PixivSession.work(workUrl).isEmpty()){
                    ui(()->status.setText("正在使用手机 Pixiv 登录读取作品…"));
                    Bundle resolved=getContentResolver().call(Uri.parse("content://"+getPackageName()+".capture-session"),"pixiv",workUrl,null);
                    if(resolved==null)throw new IOException("Pixiv 读取失败，请重试");
                    if(resolved.getBoolean("requires_login",false))throw new PixivLoginRequired(resolved.getString("error","请先登录 Pixiv"));
                    if(!resolved.getString("error","").isEmpty())throw new IOException(resolved.getString("error"));
                    input.put("browser_pixiv",new JSONObject(resolved.getString("post","{}")));
                }
                JSONObject result=request("POST","/api/captures",input.toString());jobId=result.getString("id");ui(()->{if(floating()||autoShare){if(CaptureAssistService.current!=null)CaptureAssistService.current.backgroundQueued(jobId,submissionOrigin);Toast.makeText(this,"已加入后台保存，可继续浏览",Toast.LENGTH_SHORT).show();finish();}else poll();});
            }else{
                for(int i=uploaded;i<files.size();i++){final int index=i;ui(()->status.setText("正在上传 "+(index+1)+" / "+files.size()));upload(files.get(i),target,value,i);uploaded=i+1;}
                ui(()->{String message="已保存 "+files.size()+" 个媒体文件";if(autoShare){if(CaptureAssistService.current!=null)CaptureAssistService.current.directResult(true,message);Toast.makeText(this,message,Toast.LENGTH_SHORT).show();finish();}else saved(message+"，可返回原 App");});
            }
        }catch(Exception e){ui(()->{if(e instanceof CaptureLoginRequired)login.setVisibility(View.VISIBLE);if(e instanceof PixivLoginRequired){quickSave=false;autoShare=false;pixivLogin.setVisibility(View.VISIBLE);}String message=(uploaded>0?"已保存 "+uploaded+" 个；":"")+e.getMessage();if(autoShare){if(CaptureAssistService.current!=null)CaptureAssistService.current.directResult(false,message);Toast.makeText(this,"采集失败，已发送通知",Toast.LENGTH_LONG).show();finish();return;}busy=false;save.setEnabled(true);collection.setEnabled(uploaded==0);text.setEnabled(uploaded==0);if(imageMode!=null)imageMode.setEnabled(uploaded==0);status.setText(message);});}});
    }
    private void poll(){
        if(!visible||jobId.isEmpty()||isDestroyed())return;
        final String trackedJob=jobId;worker.execute(()->{try{JSONObject job=request("GET","/api/captures/"+trackedJob,null);ui(()->{if(!trackedJob.equals(jobId)||completed)return;
            status.setText(job.optString("message"));String state=job.optString("status");
            if("completed".equals(state)){saved(job.optString("message","已保存到知识库"));}
            else if("failed".equals(state)){busy=false;save.setText("重试采集");save.setEnabled(true);save.setOnClickListener(v->{save.setEnabled(false);worker.execute(()->{try{request("POST","/api/captures/"+jobId+"/retry","{}");ui(()->{busy=true;poll();});}catch(Exception e){ui(()->{status.setText(e.getMessage());save.setEnabled(true);});}});});}
            else handler.postDelayed(this::poll,1500);
        });}catch(Exception e){ui(()->{if(!trackedJob.equals(jobId)||completed)return;if(e instanceof CaptureLoginRequired){login.setVisibility(View.VISIBLE);status.setText(e.getMessage());return;}status.setText("暂时无法读取任务状态，服务器可能仍在处理。正在重连…");handler.postDelayed(this::poll,5000);});}});
    }
    private HttpURLConnection connection(String method,String path)throws Exception{
        HttpURLConnection c=(HttpURLConnection)(ConnectionRoutes.local(origin)?new URL(origin+path).openConnection(Proxy.NO_PROXY):new URL(origin+path).openConnection());c.setRequestMethod(method);c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(30000);
        if(sessionToken!=null&&!sessionToken.isEmpty())c.setRequestProperty("Authorization","Bearer "+sessionToken);else if(sessionCookie!=null&&!sessionCookie.isEmpty())c.setRequestProperty("Cookie",sessionCookie);return c;
    }
    private static class CaptureLoginRequired extends IOException { CaptureLoginRequired(){super("手机采集授权已失效，请打开知识库重新登录；分享内容已保留");} }
    private JSONObject response(HttpURLConnection c)throws Exception{
        int code=c.getResponseCode();InputStream stream=code>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        if(stream!=null)try(InputStream in=stream){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(bytes.size()+n>2*1024*1024)throw new IOException("服务器返回内容过大");bytes.write(b,0,n);}}
        String raw=bytes.toString("UTF-8");JSONObject result;
        try{result=raw.trim().startsWith("[")?new JSONObject().put("collections",new JSONArray(raw)):new JSONObject(raw);}catch(Exception e){throw new IOException("服务器响应异常，请检查连接或更新 ZNote");}
        if(code==401)throw new CaptureLoginRequired();
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
