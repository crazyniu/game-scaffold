# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in E:\developSoftware\Android\SDK/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Proguard Cocos2d-x-lite for release
-keep public class com.cocos.** { *; }
-dontwarn com.cocos.**

# Proguard Apache HTTP for release
-keep class org.apache.http.** { *; }
-dontwarn org.apache.http.**

# Proguard okhttp for release
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**

-keep class okio.** { *; }
-dontwarn okio.**

# Proguard Android Webivew for release. you can comment if you are not using a webview
-keep public class android.net.http.SslError
-keep public class android.webkit.WebViewClient

# 不要整包保留 com.google.**（AdMob、UMP、Firebase、Play 服务）：那样 R8 对它们既不删也不优化，Play 管理中心一直提示「请使用 R8 优化」。
# 这些库的 AAR 自带混淆规则（consumer proguard rules），不用再手写。
# Cocos 引擎库自带的整包保留（com.google.**、androidx.** 等）在 app/build.gradle 里删掉了，
# 只保留引擎 C++ 经 JNI 按名字调用的游戏 SDK（GameActivity、Swappy、手柄）和 GameActivity 取窗口边距用的两个 androidx 类
-keep class com.google.androidgamesdk.** { *; }
-keep class com.google.android.games.paddleboat.** { *; }
-keep class androidx.core.view.WindowInsetsCompat$Type { *; }
-keep class androidx.core.graphics.Insets { *; }

-dontwarn android.webkit.WebView
-dontwarn android.net.http.SslError
-dontwarn android.webkit.WebViewClient

# This is generated automatically by the Android Gradle plugin.
-dontwarn android.hardware.BatteryState
-dontwarn android.hardware.lights.Light
-dontwarn android.hardware.lights.LightState$Builder
-dontwarn android.hardware.lights.LightState
-dontwarn android.hardware.lights.LightsManager$LightsSession
-dontwarn android.hardware.lights.LightsManager
-dontwarn android.hardware.lights.LightsRequest$Builder
-dontwarn android.hardware.lights.LightsRequest
-dontwarn android.net.ssl.SSLSockets
-dontwarn android.os.VibratorManager