package io.github.borderarea01.znote;
import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.util.concurrent.*;

// Runs in an isolated emulator against a disposable host library. No user device or data.
public class SmokeRunner extends Instrumentation {
    private MainActivity activity;
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private View find(View v,Class<?> type){if(type.isInstance(v))return v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){View r=find(g.getChildAt(i),type);if(r!=null)return r;}}return null;}
    private Button button(View v,String text){if(v instanceof Button&&((Button)v).getText().toString().equals(text))return(Button)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){Button b=button(g.getChildAt(i),text);if(b!=null)return b;}}return null;}
    private String js(String source)throws Exception{CompletableFuture<String> result=new CompletableFuture<>();runOnMainSync(()->{WebView web=(WebView)find(activity.getWindow().getDecorView(),WebView.class);if(web==null)result.complete("null");else web.evaluateJavascript(source,result::complete);});return result.get(8,TimeUnit.SECONDS);}
    private void until(String source)throws Exception{long deadline=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<deadline){if("true".equals(js(source)))return;Thread.sleep(250);}throw new Exception("WebView condition timed out: "+source+" body="+js("document.body.innerText.slice(0,400)"));}
    @Override public void onStart(){Bundle report=new Bundle();try{
        try{MainActivity.normalize("http://10.attacker.com");throw new Exception("public HTTP was accepted");}catch(Exception e){if(e.getMessage().equals("public HTTP was accepted"))throw e;}
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        runOnMainSync(()->{EditText address=(EditText)find(activity.getWindow().getDecorView(),EditText.class);address.setText("http://10.0.2.2:3742");button(activity.getWindow().getDecorView(),"连接并打开").performClick();});
        until("!!document.querySelector('input[type=password]')");
        js("(()=>{const i=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'0427');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.form.requestSubmit();return true})()");
        until("document.body.innerText.includes('我的知识库')");
        js("window.__result='pending';(async()=>{try{const f=new FormData();const b=await(await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZYkAAAAASUVORK5CYII=')).blob();f.append('file',b,'android-smoke.png');const r=await fetch('/api/assets',{method:'POST',body:f});window.__result=r.ok?'ok':'http-'+r.status}catch(e){window.__result=String(e)}})();true");
        until("window.__result==='ok'");
        // Verify renderer and native upload/download hooks coexist with the actual app.
        until("typeof ZNoteDownloads.markdown==='function'&&!!document.querySelector('input[type=file]')");
        runOnMainSync(()->{try{android.graphics.Bitmap shot=getUiAutomation().takeScreenshot();if(shot!=null)try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"client-smoke.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}}catch(Exception ignored){}});
        report.putString("stream","\nZNOTE_ANDROID_SMOKE_PASS\n");finish(Activity.RESULT_OK,report);
    }catch(Throwable e){report.putString("stream","\nZNOTE_ANDROID_SMOKE_FAIL: "+e+"\n");finish(Activity.RESULT_CANCELED,report);}}
}
