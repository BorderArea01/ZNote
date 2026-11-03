package io.github.borderarea01.znote;

import android.content.Context;
import android.net.Uri;
import android.os.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

/** Owned only by :capture. UI reads disk first; refresh never occupies the save queue. */
final class CaptureCatalogue {
    static final class Snapshot {
        final ArrayList<String> ids=new ArrayList<>(Collections.singletonList(""));
        final ArrayList<String> names=new ArrayList<>(Collections.singletonList("未分类"));
        String profile="";boolean cached;
    }
    interface Listener { void done(Snapshot snapshot,String error); }
    private static final Handler MAIN=new Handler(Looper.getMainLooper());
    private static final ExecutorService READER=Executors.newSingleThreadExecutor();
    private static Flight active;
    private static final class Flight {final ArrayList<Listener> listeners=new ArrayList<>();Future<?> future;volatile HttpURLConnection connection;boolean done;Runnable timeout;}
    static Snapshot read(Context context){
        Snapshot value=new Snapshot();
        try{String raw=context.getSharedPreferences("CaptureCatalogue",0).getString("snapshot","");if(raw.isEmpty())return value;JSONObject saved=new JSONObject(raw);parse(saved.getJSONArray("collections"),value);value.profile=saved.getString("profile");value.cached=true;}catch(Exception ignored){return new Snapshot();}return value;
    }
    private static void parse(JSONArray rows,Snapshot target)throws Exception{
        if(rows.length()>4096)throw new IOException("知识库列表过大");
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);String id=row.getString("id"),name=row.getString("name");if(id.isEmpty()||id.length()>200||name.isBlank()||name.length()>1000||target.ids.contains(id))throw new IOException("知识库列表格式不正确");target.ids.add(id);target.names.add(name);}
    }
    static void validate(Context context,Bundle session,String selected)throws IOException{
        Snapshot cached=read(context);
        if(cached.cached&&!cached.profile.equals(session.getString("profile","")))throw new IOException("服务器连接已变更，请刷新知识库列表后再保存；链接已保留");
        if(cached.cached&&!cached.ids.contains(selected))throw new IOException("所选知识库已不存在，请重新选择；链接已保留");
    }
    static synchronized void refresh(Context source,Listener listener){
        if(active!=null){active.listeners.add(listener);return;}
        Context context=source.getApplicationContext();Flight flight=new Flight();flight.listeners.add(listener);active=flight;
        flight.timeout=()->finish(context,flight,null,"刷新超时，仍可使用缓存选库；点击刷新可重试");MAIN.postDelayed(flight.timeout,14000);
        flight.future=READER.submit(()->{try{
            Bundle session=context.getContentResolver().call(Uri.parse("content://"+context.getPackageName()+".capture-session"),"session",null,null);
            if(session==null||session.getString("origin","").isEmpty())throw new IOException("请打开 ZNote 配置连接并登录");
            android.content.SharedPreferences sharing=context.getSharedPreferences("CaptureSharing",0);if(!sharing.contains("share_collection")&&!sharing.contains("migrated"))sharing.edit().putBoolean("migrated",true).putString("share_collection",session.getString("share_collection","")).putBoolean("capture_as_note",session.getBoolean("capture_as_note",false)).commit();
            Snapshot result=null;Exception failure=null;
            for(int attempt=0;attempt<2;attempt++){
                if(Thread.currentThread().isInterrupted())return;
                try{result=fetch(flight,session);break;}catch(ReadFailure e){failure=e;if(!e.retry)break;}catch(IOException e){failure=e;}
                if(attempt==0)Thread.sleep(250);
            }
            if(result==null)throw failure==null?new IOException("刷新未完成"):failure;
            finish(context,flight,result,"");
        }catch(Exception e){finish(context,flight,null,e.getMessage()==null?"刷新失败，请重试":e.getMessage());}});
    }
    private static final class ReadFailure extends IOException {final boolean retry;ReadFailure(String text,boolean retry){super(text);this.retry=retry;}}
    private static Snapshot fetch(Flight flight,Bundle session)throws Exception{
        String origin=MainActivity.normalize(session.getString("origin"));
        HttpURLConnection c=(HttpURLConnection)(ConnectionRoutes.local(origin)?new URL(origin+"/api/collections").openConnection(Proxy.NO_PROXY):new URL(origin+"/api/collections").openConnection());flight.connection=c;
        c.setInstanceFollowRedirects(false);c.setConnectTimeout(2500);c.setReadTimeout(3000);c.setRequestProperty("Accept","application/json");String token=session.getString("token",""),cookie=session.getString("cookie","");if(!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);else if(!cookie.isEmpty())c.setRequestProperty("Cookie",cookie);
        try{
            int code=c.getResponseCode();if(code<200||code>=300)throw new ReadFailure(code==401||code==403?"授权已失效，请打开 ZNote 登录；缓存和链接已保留":"刷新失败（HTTP "+code+"），缓存已保留",code==408||code==429||code>=500);
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] block=new byte[4096];int n;while((n=in.read(block))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();if(bytes.size()+n>1024*1024)throw new ReadFailure("知识库列表过大",false);bytes.write(block,0,n);}}
            String raw=bytes.toString("UTF-8").trim();JSONArray rows=raw.startsWith("[")?new JSONArray(raw):new JSONObject(raw).getJSONArray("collections");Snapshot result=new Snapshot();parse(rows,result);result.profile=session.getString("profile","");result.cached=true;return result;
        }finally{flight.connection=null;c.disconnect();}
    }
    private static synchronized void finish(Context context,Flight flight,Snapshot result,String error){
        if(active!=flight||flight.done)return;flight.done=true;active=null;MAIN.removeCallbacks(flight.timeout);
        if(result!=null)try{JSONArray rows=new JSONArray();for(int i=1;i<result.ids.size();i++)rows.put(new JSONObject().put("id",result.ids.get(i)).put("name",result.names.get(i)));if(!context.getSharedPreferences("CaptureCatalogue",0).edit().putString("snapshot",new JSONObject().put("collections",rows).put("profile",result.profile).put("updated_at",System.currentTimeMillis()).toString()).commit())throw new IOException("无法保存知识库缓存");}catch(Exception e){error="缓存更新失败，原列表已保留";result=null;}
        if(result==null){if(flight.future!=null)flight.future.cancel(true);HttpURLConnection connection=flight.connection;if(connection!=null)new Thread(connection::disconnect,"capture-catalogue-close").start();}
        Snapshot value=result==null?read(context):result;String message=error;for(Listener listener:flight.listeners)MAIN.post(()->listener.done(value,message));
    }
}
