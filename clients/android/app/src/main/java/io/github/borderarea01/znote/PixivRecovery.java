package io.github.borderarea01.znote;

import android.app.*;
import android.net.Uri;
import android.os.Bundle;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Retry the original failed jobs, using this phone's Pixiv session only. */
final class PixivRecovery {
    private final Activity activity;
    private final Runnable done;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private Bundle session;
    private PixivRecovery(Activity activity,Runnable done){this.activity=activity;this.done=done;}
    static void offer(Activity activity,Runnable done){new PixivRecovery(activity,done).load();}
    private void ui(Runnable run){activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())run.run();else worker.shutdown();});}
    private void finish(){worker.shutdown();done.run();}
    private void load(){
        ProgressDialog progress=ProgressDialog.show(activity,"Pixiv 已登录","正在查找可补采的失败记录…",true,false);
        worker.execute(()->{try{
            session=activity.getContentResolver().call(Uri.parse("content://"+activity.getPackageName()+".capture-session"),"session",null,null);
            JSONArray jobs=request("GET","/api/captures",null).getJSONArray("jobs");List<JSONObject> failed=new ArrayList<>();
            for(int i=0;i<jobs.length();i++){JSONObject job=jobs.getJSONObject(i);if("failed".equals(job.optString("status"))&&!PixivSession.work(job.optString("source_url")).isEmpty())failed.add(job);}
            ui(()->{progress.dismiss();if(failed.isEmpty()){finish();return;}String[] labels=new String[failed.size()];boolean[] selected=new boolean[failed.size()];String today=java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString();
                for(int i=0;i<failed.size();i++){JSONObject job=failed.get(i);String created=job.optString("created_at");labels[i]=(created.length()>=10?created.substring(0,10)+" · ":"")+"作品 "+PixivSession.work(job.optString("source_url"));selected[i]=created.startsWith(today);}
                new AlertDialog.Builder(activity).setTitle("补采 Pixiv 失败记录").setMultiChoiceItems(labels,selected,(d,index,value)->selected[index]=value).setNegativeButton("暂不补采",(d,w)->finish()).setPositiveButton("重试所选",(d,w)->retry(failed,selected)).setOnCancelListener(d->finish()).show();
            });
        }catch(Exception e){ui(()->{progress.dismiss();new AlertDialog.Builder(activity).setTitle("Pixiv 登录已保留").setMessage("暂时无法读取采集记录："+e.getMessage()).setPositiveButton("完成",(d,w)->finish()).setOnCancelListener(d->finish()).show();});}});
    }
    private void retry(List<JSONObject> jobs,boolean[] selected){
        ProgressDialog progress=ProgressDialog.show(activity,"正在补采","读取作品并提交原任务…",true,false);
        worker.execute(()->{int queued=0,failed=0;String error="";
            for(int i=0;i<selected.length;i++)if(selected[i])try{
                JSONObject job=jobs.get(i);Bundle resolved=PixivSession.resolve(job.getString("source_url"));if(resolved.containsKey("error"))throw new IOException(resolved.getString("error"));
                String id=job.getString("id");if(!id.matches("[a-zA-Z0-9_-]{1,128}"))throw new IOException("采集编号无效");
                request("POST","/api/captures/"+id+"/retry",new JSONObject().put("browser_pixiv",new JSONObject(resolved.getString("post"))));queued++;
            }catch(Exception e){failed++;error=e.getMessage();}
            final String result="已提交 "+queued+" 条原任务，服务器将继续保存"+(failed>0?"；"+failed+" 条未提交："+error:"");
            ui(()->{progress.dismiss();new AlertDialog.Builder(activity).setTitle("补采进度").setMessage(result).setPositiveButton("完成",(d,w)->finish()).setOnCancelListener(d->finish()).show();});
        });
    }
    private JSONObject request(String method,String path,JSONObject body)throws Exception{
        String origin=session==null?"":session.getString("origin","");if(origin.isEmpty())throw new IOException("请先连接 ZNote 服务器");origin=MainActivity.normalize(origin);
        HttpURLConnection c=(HttpURLConnection)(ConnectionRoutes.local(origin)?new URL(origin+path).openConnection(Proxy.NO_PROXY):new URL(origin+path).openConnection());
        try{c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(20000);c.setRequestMethod(method);String token=session.getString("token",""),cookie=session.getString("cookie","");if(!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);else if(cookie!=null&&!cookie.isEmpty())c.setRequestProperty("Cookie",cookie);
            if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
            int status=c.getResponseCode();InputStream stream=status>=200&&status<300?c.getInputStream():c.getErrorStream();if(stream==null)throw new IOException("采集接口 HTTP "+status);
            ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=stream){byte[] bytes=new byte[4096];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>2097152)throw new IOException("采集记录过大");out.write(bytes,0,n);}}
            JSONObject result=new JSONObject(out.toString("UTF-8"));if(status<200||status>=300)throw new IOException(result.optString("error","采集接口 HTTP "+status));return result;
        }finally{c.disconnect();}
    }
}
