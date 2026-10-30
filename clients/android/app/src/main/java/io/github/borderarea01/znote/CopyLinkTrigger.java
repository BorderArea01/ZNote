package io.github.borderarea01.znote;

/** Matches copy-link actions only, not arbitrary Copy/password/text events. */
final class CopyLinkTrigger {
    private long last;
    static boolean label(CharSequence value){
        if(value==null||value.length()>100)return false;
        String text=value.toString().replaceAll("\\s+","").replaceAll("[,，。.!！]+$","");
        return text.matches("(?i)^(复制(分享)?(的)?链接(到剪贴板)?|copy(link|url)(toclipboard)?)(按钮)?$");
    }
    boolean accept(long eventTime,long now){if(eventTime<=0||now-eventTime<0||now-eventTime>2500||eventTime<=last||now-last<900)return false;last=now;return true;}
    static boolean completed(CharSequence value){if(value==null||value.length()>100)return false;return value.toString().replaceAll("\\s+","").replaceAll("[,，。.!！]+$","").matches("(?i)^(链接已复制(到剪贴板)?|已复制(分享)?链接|复制(分享)?链接成功|linkcopied|urlcopied)$");}
}
