package io.github.borderarea01.znote;

import java.net.URI;
import java.util.Locale;

/** Routing is selected before a new operation; submitted jobs keep their origin. */
final class ConnectionRoutes {
    interface Reachable { boolean check(String origin); }
    static boolean local(String origin){
        try{
            String host=new URI(origin).getHost();if(host==null)return false;host=host.toLowerCase(Locale.ROOT).replace("[","").replace("]","");
            if(host.equals("localhost")||host.equals("::1")||host.endsWith(".local")||host.endsWith(".lan")||host.endsWith(".home.arpa"))return true;
            if(host.contains(":"))return host.matches("f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*");
            if(host.matches("[0-9]+(\\.[0-9]+){3}")){String[] parts=host.split("\\.");int a=Integer.parseInt(parts[0]),b=Integer.parseInt(parts[1]);for(String part:parts)if(Integer.parseInt(part)>255)return false;return a==10||a==127||a==192&&b==168||a==172&&b>=16&&b<=31;}
            return !host.contains(".");
        }catch(Exception ignored){return false;}
    }
    static String choose(String preferred,String lan,String remote,boolean localOnly,Reachable reachable){
        // A manually configured full public server keeps its existing upload
        // capability. localOnly excludes the paired link-only relay, not that
        // explicit server.
        if(!preferred.isEmpty()&&!local(preferred)&&!preferred.equals(remote))return preferred;
        if(!lan.isEmpty()&&reachable.check(lan))return lan;
        if(localOnly)return "";
        if(!remote.isEmpty())return remote;
        return preferred;
    }
}
