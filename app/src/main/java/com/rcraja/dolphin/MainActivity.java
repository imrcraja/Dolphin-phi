package com.rcraja.dolphin;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebResourceResponse;
import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import java.io.*;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView webView;
    private OutputStream backupOut;
    private Uri backupUri;
    private InputStream restoreIn;
    private long restoreSize;
    private File mirrorFile;
    private OutputStream mirrorOut;
    private static final int PICK_RESTORE=4101;

    private File modelMirror(){File root=new File(getExternalFilesDir(null),"models");if(!root.exists())root.mkdirs();return new File(root,"dolphin-2_6-phi-2.Q4_K_M.gguf");}

    private class DolphinStorage {
        @JavascriptInterface public String storagePath(){return modelMirror().getParentFile().getAbsolutePath();}
        @JavascriptInterface public synchronized void beginMirror(String name) throws IOException {if(mirrorOut!=null)mirrorOut.close();mirrorFile=modelMirror();mirrorOut=new BufferedOutputStream(new FileOutputStream(mirrorFile,false),1024*1024);}
        @JavascriptInterface public synchronized void writeMirrorChunk(String b64) throws IOException {if(mirrorOut==null)throw new IOException("Mirror not started");mirrorOut.write(android.util.Base64.decode(b64,android.util.Base64.DEFAULT));}
        @JavascriptInterface public synchronized void finishMirror() throws IOException {if(mirrorOut!=null){mirrorOut.flush();mirrorOut.close();mirrorOut=null;}}
        @JavascriptInterface public synchronized void beginBackup(String name) throws IOException {
            if(android.os.Build.VERSION.SDK_INT<29)throw new IOException("Downloads backup requires Android 10+.");
            if(backupOut!=null)backupOut.close();
            android.content.ContentValues v=new android.content.ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME,name);
            v.put(MediaStore.Downloads.MIME_TYPE,"application/octet-stream");
            v.put(MediaStore.Downloads.RELATIVE_PATH,"Download/RC Dolphin AI");
            v.put(MediaStore.Downloads.IS_PENDING,1);
            backupUri=getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,v);
            if(backupUri==null)throw new IOException("Could not create Downloads file");
            backupOut=new BufferedOutputStream(getContentResolver().openOutputStream(backupUri),1024*1024);
        }
        @JavascriptInterface public synchronized void writeBackupChunk(String b64) throws IOException {if(backupOut==null)throw new IOException("Backup not started");backupOut.write(android.util.Base64.decode(b64,android.util.Base64.DEFAULT));}
        @JavascriptInterface public synchronized void finishBackup() throws IOException {if(backupOut!=null){backupOut.flush();backupOut.close();backupOut=null;}if(backupUri!=null&&android.os.Build.VERSION.SDK_INT>=29){android.content.ContentValues v=new android.content.ContentValues();v.put(MediaStore.Downloads.IS_PENDING,0);getContentResolver().update(backupUri,v,null,null);}}
        @JavascriptInterface public void requestRestore(){startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/octet-stream").addCategory(Intent.CATEGORY_OPENABLE),PICK_RESTORE);}
        @JavascriptInterface public synchronized long restoreSize(){return restoreSize;}
        @JavascriptInterface public synchronized String readRestoreChunk(long offset,int length) throws IOException {
            if(restoreIn==null)throw new IOException("No restore file selected");
            if(offset!=0&&offset!=restoreOffset){restoreIn.close();restoreIn=getContentResolver().openInputStream(restoreUri);skipFully(restoreIn,offset);}
            byte[] b=new byte[length];int n=0,r;while(n<length&&(r=restoreIn.read(b,n,length-n))>0)n+=r;restoreOffset=offset+n;return android.util.Base64.encodeToString(java.util.Arrays.copyOf(b,n),android.util.Base64.NO_WRAP);
        }
        private long restoreOffset=0;private Uri restoreUri;
    }
    private final DolphinStorage bridge=new DolphinStorage();

    private static void skipFully(InputStream in,long n)throws IOException{while(n>0){long s=in.skip(n);if(s<=0){if(in.read()<0)break;s=1;}n-=s;}}

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle savedInstanceState){
        super.onCreate(savedInstanceState);
        webView=new WebView(this);WebSettings s=webView.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setDatabaseEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMediaPlaybackRequiresUserGesture(false);s.setSupportZoom(false);s.setBuiltInZoomControls(false);s.setDisplayZoomControls(false);s.setCacheMode(WebSettings.LOAD_DEFAULT);
        webView.addJavascriptInterface(bridge,"DolphinStorage");
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClientCompat(){@Override public WebResourceResponse shouldInterceptRequest(WebView v,android.webkit.WebResourceRequest r){return loader.shouldInterceptRequest(r.getUrl());}@Override public WebResourceResponse shouldInterceptRequest(WebView v,String u){return loader.shouldInterceptRequest(Uri.parse(u));}});
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");setContentView(webView);
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,@Nullable Intent data){super.onActivityResult(requestCode,resultCode,data);if(requestCode==PICK_RESTORE&&resultCode==RESULT_OK&&data!=null&&data.getData()!=null){try{restoreUri=data.getData();getContentResolver().takePersistableUriPermission(restoreUri,data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));android.database.Cursor c=getContentResolver().query(restoreUri,null,null,null,null);restoreSize=0;if(c!=null){int i=c.getColumnIndex(MediaStore.MediaColumns.SIZE);if(c.moveToFirst()&&i>=0)restoreSize=c.getLong(i);c.close();}if(restoreSize<=0)throw new IOException("Could not determine backup file size");restoreIn=getContentResolver().openInputStream(restoreUri);restoreOffset=0;webView.evaluateJavascript("window.onNativeRestoreReady&&window.onNativeRestoreReady()",null);}catch(Exception e){webView.evaluateJavascript("alert("+org.json.JSONObject.quote("Restore selection failed: "+e.getMessage())+")",null);}}}
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){try{if(backupOut!=null)backupOut.close();if(mirrorOut!=null)mirrorOut.close();if(restoreIn!=null)restoreIn.close();}catch(Exception ignored){}super.onDestroy();}
}