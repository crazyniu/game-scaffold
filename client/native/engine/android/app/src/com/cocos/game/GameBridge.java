// 脚本和 Android 原生之间的桥，事件表见 assets/scripts/platform/platformNative.ts 的文件头（和 iOS 的 GameBridge.mm 同一组）。
// 广告在 GameAds：开着广告时是 app/ads/on 里的 AdMob 实现，关掉时是 app/ads/off 里的空实现（app/build.gradle 的 GAME_ADS）。
// 统计和崩溃报告在 GameFirebase：同样分 app/firebase/on 和 app/firebase/off（GAME_FIREBASE）。
package com.cocos.game;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.cocos.lib.CocosHelper;
import com.cocos.lib.JsbBridgeWrapper;

import org.json.JSONException;
import org.json.JSONObject;

public final class GameBridge {
    private static Activity activity;

    private GameBridge() {}

    /** AppActivity.onCreate 里调一次：注册事件 */
    public static void setup(Activity act) {
        activity = act;
        GameFirebase.start(act);
        JsbBridgeWrapper bridge = JsbBridgeWrapper.getInstance();
        bridge.addScriptEventListener("game.init", arg -> ui(() -> GameAds.start(activity, parse(arg).optJSONObject("ads"))));
        bridge.addScriptEventListener("game.rewarded", arg -> ui(GameAds::showRewarded));
        bridge.addScriptEventListener("game.interstitial", arg -> ui(GameAds::showInterstitial));
        bridge.addScriptEventListener("game.banner", arg -> ui(() -> GameAds.setBannerVisible(parse(arg).optBoolean("show", false))));
        bridge.addScriptEventListener("game.privacy", arg -> ui(GameAds::openPrivacyOptions));
        bridge.addScriptEventListener("game.vibrate", arg -> ui(() -> vibrate(parse(arg).optString("kind", "medium"))));
        // 统计、脚本错误：不用切到界面线程
        bridge.addScriptEventListener("game.track", arg -> {
            JSONObject o = parse(arg);
            GameFirebase.track(o.optString("name", ""), o.optJSONObject("params"));
        });
        bridge.addScriptEventListener("game.error", arg -> {
            JSONObject o = parse(arg);
            GameFirebase.error(o.optString("message", ""), o.optString("stack", ""));
        });
        bridge.addScriptEventListener("game.share", arg -> ui(() -> share(parse(arg).optString("text", ""))));
    }

    // ---------------------------------------------------------------- 震动、分享

    private static void vibrate(String kind) {
        Vibrator v = (Vibrator) activity.getSystemService(Activity.VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator()) return;
        int ms = "light".equals(kind) ? 12 : "heavy".equals(kind) ? 45 : 25;
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        else v.vibrate(ms);
    }

    private static void share(String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        activity.startActivity(Intent.createChooser(send, null));
        // 打开系统选择器不代表用户完成分享。
        send("game.share", "{\"ok\":false}");
    }

    // ---------------------------------------------------------------- 工具

    private static void ui(Runnable r) {
        activity.runOnUiThread(r);
    }

    /** 回给脚本：脚本跑在游戏线程上，从那里发 */
    static void send(String event, String json) {
        CocosHelper.runOnGameThread(() -> JsbBridgeWrapper.getInstance().dispatchEventToScript(event, json));
    }

    private static JSONObject parse(String arg) {
        try {
            return new JSONObject(arg == null || arg.isEmpty() ? "{}" : arg);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }
}
