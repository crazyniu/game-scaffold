// Firebase：统计（Analytics）+ 崩溃报告（Crashlytics）。game.json 的 firebase.enabled 为 true、并且放了 firebase/google-services.json 时编进包
// （app/build.gradle 的 GAME_FIREBASE；关掉时用 firebase/off 里的空实现，也不依赖 Firebase）。由 GameBridge 转调，事件表见 platformNative.ts。
// 原生崩溃（Java、引擎的 C++）Crashlytics 自己收；脚本里没接住的错误由脚本发 game.error 过来，记成「非致命」问题。
package com.cocos.game;

import android.app.Activity;
import android.os.Bundle;

import com.google.firebase.analytics.FirebaseAnalytics;
import com.google.firebase.crashlytics.FirebaseCrashlytics;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class GameFirebase {
    private static FirebaseAnalytics analytics;

    private GameFirebase() {}

    /** AppActivity 启动时（GameBridge.setup）调一次。Firebase 本身由 google-services 插件生成的配置自动初始化 */
    static void start(Activity act) {
        analytics = FirebaseAnalytics.getInstance(act);
    }

    /** game.track：参数只收字符串、数字、布尔（布尔记成 0 / 1），名字和长度脚本那头已经按 Firebase 的规矩截好 */
    static void track(String name, JSONObject params) {
        if (analytics == null || name.isEmpty()) return;
        Bundle b = new Bundle();
        if (params != null) {
            Iterator<String> keys = params.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                Object v = params.opt(k);
                if (v instanceof Boolean) b.putLong(k, (Boolean) v ? 1 : 0);
                else if (v instanceof Integer || v instanceof Long) b.putLong(k, ((Number) v).longValue());
                else if (v instanceof Number) b.putDouble(k, ((Number) v).doubleValue());
                else if (v instanceof String) b.putString(k, (String) v);
            }
        }
        analytics.logEvent(name, b);
    }

    /** game.error：脚本里没接住的错误。按脚本的调用栈造一个异常，Crashlytics 按调用栈把同一个错误归成一个问题 */
    static void error(String message, String stack) {
        Throwable t = new ScriptError(message);
        t.setStackTrace(frames(stack));
        FirebaseCrashlytics.getInstance().recordException(t);
    }

    /** 脚本的错误（类名就是 Crashlytics 里问题的标题） */
    static final class ScriptError extends RuntimeException {
        ScriptError(String message) {
            super(message);
        }
    }

    /** V8 的调用栈：「    at 函数名 (文件:行:列)」或「    at 文件:行:列」 */
    private static final Pattern FRAME = Pattern.compile("^\\s*at (?:(.+?) \\()?(.+?):(\\d+):\\d+\\)?\\s*$");

    private static StackTraceElement[] frames(String stack) {
        List<StackTraceElement> out = new ArrayList<>();
        for (String line : (stack == null ? "" : stack).split("\n")) {
            Matcher m = FRAME.matcher(line);
            if (!m.matches()) continue;
            String fn = m.group(1) == null ? "<anonymous>" : m.group(1);
            String file = m.group(2);
            int slash = file.lastIndexOf('/');
            if (slash >= 0) file = file.substring(slash + 1);
            int lineNo;
            try {
                lineNo = Integer.parseInt(m.group(3));
            } catch (NumberFormatException e) {
                lineNo = -1;
            }
            out.add(new StackTraceElement("js", fn, file, lineNo));
            if (out.size() >= 64) break;
        }
        if (out.isEmpty()) out.add(new StackTraceElement("js", "<unknown>", "script", -1));
        return out.toArray(new StackTraceElement[0]);
    }
}
