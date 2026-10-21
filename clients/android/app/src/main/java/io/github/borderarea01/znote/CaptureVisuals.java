package io.github.borderarea01.znote;

import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.os.SystemClock;

/** Small vector artwork shared by the floating card, bookmark and result hint. */
final class CaptureVisuals {
    static final int INK=0xffe7ebf5, MUTED=0xffabb7ce, ACCENT=0xff8da0ed,
        SUCCESS=0xff9bbcae, WARNING=0xffd3b185, SURFACE=0xff212938;
    private CaptureVisuals(){}

    static Drawable icon(Context context,String name,int color,int size){
        return new Icon(name,color,Math.round(size*context.getResources().getDisplayMetrics().density));
    }
    private static void logo(Canvas canvas,RectF box,Paint paint){
        canvas.save();canvas.translate(box.left,box.top);canvas.scale(box.width()/64f,box.height()/64f);
        paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(6);Path path=new Path();
        path.moveTo(16,23);path.cubicTo(23,14,35,24,46,18);path.cubicTo(49,16.5f,49,20.5f,43,25.5f);
        path.lineTo(20,42.5f);path.cubicTo(16,46,18,49,22,46.5f);path.cubicTo(30,41.5f,42,51,49,42);
        canvas.drawPath(path,paint);canvas.restore();
    }
    private static final class Icon extends Drawable {
        private final String name;private final int color,size;private final Paint paint=new Paint(3);
        Icon(String name,int color,int size){this.name=name;this.color=color;this.size=size;}
        @Override public int getIntrinsicWidth(){return size;}
        @Override public int getIntrinsicHeight(){return size;}
        @Override public void draw(Canvas c){
            Rect b=getBounds();paint.setColor(color);paint.setStyle(Paint.Style.STROKE);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);
            if(name.equals("z")){logo(c,new RectF(b),paint);return;}
            c.save();c.translate(b.left,b.top);c.scale(b.width()/24f,b.height()/24f);paint.setStrokeWidth(1.65f);Path p=new Path();
            switch(name){
                case "folder":p.moveTo(3,7);p.lineTo(3,5);p.quadTo(3,3,5,3);p.lineTo(9,3);p.lineTo(12,6);p.lineTo(19,6);p.quadTo(21,6,21,8);p.lineTo(21,19);p.quadTo(21,21,19,21);p.lineTo(5,21);p.quadTo(3,21,3,19);p.close();break;
                case "down":p.moveTo(7,10);p.lineTo(12,15);p.lineTo(17,10);break;
                case "capture":p.moveTo(8,3);p.lineTo(3,3);p.lineTo(3,8);p.moveTo(16,3);p.lineTo(21,3);p.lineTo(21,8);p.moveTo(3,16);p.lineTo(3,21);p.lineTo(8,21);p.moveTo(21,16);p.lineTo(21,21);p.lineTo(16,21);p.moveTo(8,12);p.lineTo(16,12);p.moveTo(12,8);p.lineTo(12,16);break;
                case "paste":c.drawRoundRect(8,8,20,21,2,2,paint);p.moveTo(15,8);p.lineTo(15,5);p.quadTo(15,3,13,3);p.lineTo(5,3);p.quadTo(3,3,3,5);p.lineTo(3,15);p.quadTo(3,17,5,17);p.lineTo(8,17);break;
                case "check":p.moveTo(5,12);p.lineTo(9,16);p.lineTo(19,6);break;
                case "alert":c.drawCircle(12,12,8,paint);p.moveTo(12,7);p.lineTo(12,13);p.moveTo(12,17);p.lineTo(12.01f,17);break;
                default:p.moveTo(5,12);p.lineTo(19,12);p.moveTo(14,7);p.lineTo(19,12);p.lineTo(14,17);break;
            }
            c.drawPath(p,paint);c.restore();
        }
        @Override public void setAlpha(int alpha){}
        @Override public void setColorFilter(ColorFilter filter){}
        @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    }

    /** B: a short edge bookmark which becomes a complete folded square off-edge. */
    static final class Bookmark extends Drawable {
        private final float density;private final Paint paint=new Paint(3);private final Path path=new Path();
        private boolean right=true;private float free;private int state;
        Bookmark(Context context){density=context.getResources().getDisplayMetrics().density;paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeJoin(Paint.Join.ROUND);}
        void state(boolean right,float free,int state){this.right=right;this.free=Math.max(0,Math.min(1,free));this.state=state;invalidateSelf();}
        @Override public void draw(Canvas c){
            Rect bounds=getBounds();float w=(15+25*free)*density,h=(38+2*free)*density,r=(4+8*free)*density;
            float x=free>0?(bounds.width()-w)/2f:right?bounds.width()-w:0,y=(bounds.height()-h)/2f;
            c.save();c.translate(bounds.left+x,bounds.top+y);float cut=4*density*(1-free);
            path.reset();path.moveTo(r,0);path.lineTo(w-r,0);path.quadTo(w,0,w,r);path.lineTo(w,h-r);path.quadTo(w,h,w-r,h);path.lineTo(w*.66f,h);path.lineTo(w*.5f,h-cut);path.lineTo(w*.34f,h);path.lineTo(r,h);path.quadTo(0,h,0,h-r);path.lineTo(0,r);path.quadTo(0,0,r,0);path.close();
            paint.setStyle(Paint.Style.FILL);paint.setColor(SURFACE);paint.setAlpha(Math.round(220+35*free));c.drawPath(path,paint);
            paint.setStyle(Paint.Style.STROKE);paint.setColor(0xff596780);paint.setAlpha(255);paint.setStrokeWidth(density);c.drawPath(path,paint);
            if(free>.05f){
                paint.setColor(INK);paint.setAlpha(Math.round(255*free));float s=23*density;logo(c,new RectF((w-s)/2,(h-s)/2,(w+s)/2,(h+s)/2),paint);
                paint.setColor(0xff72819d);paint.setAlpha(Math.round(255*free));paint.setStrokeWidth(density);paint.setStyle(Paint.Style.STROKE);Path fold=new Path();fold.moveTo(w-11*density,3*density);fold.lineTo(w-11*density,10*density);fold.lineTo(w-4*density,10*density);c.drawPath(fold,paint);
            }else{
                paint.setColor(MUTED);paint.setStrokeWidth(1.5f*density);c.drawLine(w/2,12*density,w/2,21*density,paint);
            }
            if(state==1){
                float phase=(SystemClock.uptimeMillis()%1400)/1400f;paint.setColor(ACCENT);paint.setStrokeWidth(1.7f*density);paint.setStyle(Paint.Style.STROKE);paint.setAlpha(255);
                if(free>.5f)c.drawArc(-2*density,-2*density,w+2*density,h+2*density,phase*360,105,false,paint);
                else{paint.setAlpha(100+(int)(155*Math.abs(Math.sin(phase*Math.PI))));c.drawLine(w/2,8*density,w/2,24*density,paint);}
            }else if(state==2||state==3){paint.setStyle(Paint.Style.FILL);paint.setColor(state==2?SUCCESS:WARNING);paint.setAlpha(255);c.drawCircle(w/2,h-7*density,2*density,paint);}
            c.restore();
        }
        @Override public void setAlpha(int alpha){}
        @Override public void setColorFilter(ColorFilter filter){}
        @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
    }
}
