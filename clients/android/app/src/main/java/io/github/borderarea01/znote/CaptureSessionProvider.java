package io.github.borderarea01.znote;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.webkit.CookieManager;

/** Main process owns WebView login; only our capture process may read a snapshot.
 * Callers use a worker: a cold WebView provider must never block overlay input. */
public class CaptureSessionProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    @Override public Bundle call(String method,String arg,Bundle extras){
        if(Binder.getCallingUid()!=android.os.Process.myUid())throw new SecurityException("Private capture session");
        if(!"session".equals(method))throw new IllegalArgumentException("Unsupported operation");
        SharedPreferences prefs=getContext().getSharedPreferences("MainActivity",0);
        String origin=prefs.getString("origin","");Bundle result=new Bundle();result.putString("origin",origin);
        result.putString("cookie",origin.isEmpty()?"":CookieManager.getInstance().getCookie(origin));
        result.putString("share_collection",prefs.getString("share_collection",""));result.putBoolean("capture_as_note",prefs.getBoolean("capture_as_note",false));return result;
    }
    @Override public Cursor query(Uri u,String[] p,String s,String[] a,String o){throw new UnsupportedOperationException();}
    @Override public String getType(Uri u){return null;}
    @Override public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    @Override public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
    @Override public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
