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
    private void checkpoint(String text){Bundle update=new Bundle();update.putString("stream","\n"+text+"\n");sendStatus(0,update);}
    private String nativeText(View v){String result=v instanceof TextView?((TextView)v).getText().toString()+" | ":"";if(v instanceof ViewGroup){ViewGroup group=(ViewGroup)v;for(int i=0;i<group.getChildCount();i++)result+=nativeText(group.getChildAt(i));}return result;}
    private void screenshot(){try{android.graphics.Bitmap shot=getUiAutomation().takeScreenshot();if(shot!=null)try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(getTargetContext().getExternalFilesDir(null),"client-smoke.png"))){shot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}}catch(Exception ignored){}}
    @Override public void onCreate(Bundle args){super.onCreate(args);start();}
    private View find(View v,Class<?> type){if(type.isInstance(v))return v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){View r=find(g.getChildAt(i),type);if(r!=null)return r;}}return null;}
    private Button button(View v,String text){if(v instanceof Button&&((Button)v).getText().toString().equals(text))return(Button)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){Button b=button(g.getChildAt(i),text);if(b!=null)return b;}}return null;}
    private String js(String source)throws Exception{CompletableFuture<String> result=new CompletableFuture<>();runOnMainSync(()->{WebView web=(WebView)find(activity.getWindow().getDecorView(),WebView.class);if(web==null)result.complete("null");else web.evaluateJavascript(source,result::complete);});return result.get(8,TimeUnit.SECONDS);}
    private void until(String source)throws Exception{long deadline=System.currentTimeMillis()+30000;while(System.currentTimeMillis()<deadline){if("true".equals(js(source)))return;Thread.sleep(250);}throw new Exception("WebView condition timed out: "+source+" body="+js("document.body.innerText.slice(0,400)+String(window.__result)"));}
    @Override public void onStart(){Bundle report=new Bundle();try{
        try{MainActivity.normalize("http://10.attacker.com");throw new Exception("public HTTP was accepted");}catch(Exception e){if(e.getMessage().equals("public HTTP was accepted"))throw e;}
        activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        runOnMainSync(()->{EditText address=(EditText)find(activity.getWindow().getDecorView(),EditText.class);address.setText("http://10.0.2.2:3742");button(activity.getWindow().getDecorView(),"连接并打开").performClick();});
        until("!!document.querySelector('input[type=password]')");
        checkpoint("Android connected to disposable LAN server");
        js("(()=>{const i=document.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'0427');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.form.requestSubmit();return true})()");
        until("document.body.innerText.includes('我的知识库')");
        checkpoint("Android password setup complete");
        js("window.__result='pending';(async()=>{try{const f=new FormData();const canvas=document.createElement('canvas');canvas.width=canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);const b=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));f.append('file',b,'android-smoke.png');const r=await fetch('/api/assets',{method:'POST',body:f});window.__result=r.ok?'ok':'http-'+r.status}catch(e){window.__result=String(e)}})();true");
        until("window.__result==='ok'");
        checkpoint("Android image upload complete");
        until("!!document.querySelector('.library-card:not(.new-library)')");
        js("document.querySelector('.library-card:not(.new-library)').click();true");
        until("document.body.innerText.includes('android-smoke.png')&&!!document.querySelector('.item-card img')&&document.querySelector('.item-card img').complete&&document.querySelector('.item-card img').naturalWidth>0");
        // Verify renderer and native upload/download hooks coexist with the actual app.
        until("typeof ZNoteDownloads.markdown==='function'&&!!document.querySelector('input[type=file]')");
        js("document.querySelector('.card-main').click();true");
        until("!!document.querySelector('.detail-dialog')");
        js("document.querySelector('.image-stage button').click();true");
        until("!!document.querySelector('.zoom-viewer')");
        getUiAutomation().executeShellCommand("input keyevent 4").close();
        until("!document.querySelector('.zoom-viewer')&&!!document.querySelector('.detail-dialog')");
        checkpoint("System Back closes zoom while retaining image detail");
        getUiAutomation().executeShellCommand("input keyevent 4").close();
        until("!document.querySelector('[role=dialog]')&&!!document.querySelector('.item-card')");
        checkpoint("System Back closes image detail while retaining library");
        js("document.querySelector('.card-main').click();true");until("!!document.querySelector('.detail-dialog')");
        runOnMainSync(()->button(activity.getWindow().getDecorView(),"‹").performClick());
        until("!document.querySelector('[role=dialog]')&&!!document.querySelector('.item-card')");
        if(activity.isFinishing()||activity.isDestroyed())throw new Exception("Back destroyed the client");
        screenshot();
        report.putString("stream","\nZNOTE_ANDROID_SMOKE_PASS\n");finish(Activity.RESULT_OK,report);
    }catch(Throwable e){String[] nativeState={""};if(activity!=null)runOnMainSync(()->nativeState[0]=nativeText(activity.getWindow().getDecorView()));String failure="\nZNOTE_ANDROID_SMOKE_FAIL: "+e+"\nNative UI: "+nativeState[0]+"\n";checkpoint(failure);screenshot();report.putString("stream",failure);finish(Activity.RESULT_CANCELED,report);}}
}
