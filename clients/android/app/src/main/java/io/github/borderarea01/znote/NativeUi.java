package io.github.borderarea01.znote;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.drawable.*;
import android.view.*;
import android.widget.*;

/** Shared native chrome; explanations live behind an explicit help control. */
final class NativeUi {
    static final int BG=0xff141720, SURFACE=0xff202532, TEXT=0xffedf0f8, MUTED=0xffa5afc5, ACCENT=0xff737fed;
    static int dp(Context c,int n){return Math.round(n*c.getResources().getDisplayMetrics().density);}
    static GradientDrawable shape(Context c,int color,int radius){GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(dp(c,radius));return g;}
    static Button button(Context c,String text,Runnable action){
        Button b=new Button(c);b.setText(text);b.setAllCaps(false);b.setTextSize(14);b.setMinHeight(dp(c,48));b.setMinimumHeight(dp(c,48));b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(c,14),dp(c,8),dp(c,14),dp(c,8));
        b.setTextColor(new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled},new int[]{}},new int[]{0xff778299,TEXT}));
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33737fed),shape(c,SURFACE,12),null));b.setStateListAnimator(null);b.setOnClickListener(v->action.run());return b;
    }
    static void primary(Button b){b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33ffffff),shape(b.getContext(),0xff535fc6,12),null));}
    static void quiet(Button b){b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33737fed),shape(b.getContext(),0x00000000,12),null));}
    static TextView label(Context c,String text,int size){TextView t=new TextView(c);t.setText(text);t.setTextColor(TEXT);t.setTextSize(size);return t;}
    static LinearLayout card(LinearLayout root,String title){Context c=root.getContext();TextView heading=label(c,title,13);heading.setTextColor(MUTED);LinearLayout.LayoutParams h=new LinearLayout.LayoutParams(-1,-2);h.setMargins(dp(c,4),dp(c,24),0,dp(c,10));root.addView(heading,h);LinearLayout card=new LinearLayout(c);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(c,12),dp(c,8),dp(c,12),dp(c,8));card.setBackground(shape(c,SURFACE,18));root.addView(card);return card;}
    static void row(LinearLayout root,Button b){quiet(b);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(root.getContext(),52));p.setMargins(0,dp(root.getContext(),2),0,dp(root.getContext(),2));root.addView(b,p);}
}
