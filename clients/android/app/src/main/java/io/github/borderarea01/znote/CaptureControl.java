package io.github.borderarea01.znote;

import android.content.*;
import android.os.*;

/** Package-scoped IPC: only the capture process owns its window and preferences. */
final class CaptureControl {
    static final String ACTION="io.github.borderarea01.znote.CAPTURE_CONTROL";
    static void send(Context context,String command,ResultReceiver reply){
        context.sendBroadcast(new Intent(ACTION).setPackage(context.getPackageName()).addFlags(Intent.FLAG_RECEIVER_FOREGROUND).putExtra("command",command).putExtra("reply",reply));
    }
}
