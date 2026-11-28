// 广告：Google Mobile Ads（AdMob）+ 用户同意（UMP，欧洲等地要先问）。game.json 的 ads.enabled 为 true 时编进包
// （app/build.gradle 的 GAME_ADS；关掉时用 ads/off 里的空实现，也不依赖广告 SDK）。由 GameBridge 转调，事件表见 platformNative.ts。
package com.cocos.game;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

import org.json.JSONObject;

final class GameAds {
    private static Activity activity;
    private static String rewardedUnit = "";
    private static String interstitialUnit = "";
    private static String bannerUnit = "";
    private static RewardedAd rewarded;
    private static InterstitialAd interstitial;
    private static AdView banner;
    private static boolean earned;
    /** 加载失败后隔多久再试（秒）：15 秒起逐次加倍，最长 5 分钟；加载成功就重置。
     * 上架前和刚上架时填充很低、断网时也会失败，不重试的话这一局入口一直是灰的 */
    private static final int RETRY_FIRST = 15;
    private static final int RETRY_MAX = 300;
    private static int rewardedRetry = RETRY_FIRST;
    private static int interstitialRetry = RETRY_FIRST;
    private static int consentRetry = RETRY_FIRST;
    private static final Handler main = new Handler(Looper.getMainLooper());

    private GameAds() {}

    private static void send(String event, String json) {
        GameBridge.send(event, json);
    }

    /** game.init：记下广告位，先问同意（UMP），能请求广告了再启动 SDK、预加载 */
    static void start(Activity act, JSONObject ads) {
        activity = act;
        if (ads != null) {
            rewardedUnit = ads.optString("rewarded", "");
            interstitialUnit = ads.optString("interstitial", "");
            bannerUnit = ads.optString("banner", "");
        }
        // 没配激励视频广告位就当这一版没有广告：不问同意，看广告的入口隐藏
        if (rewardedUnit.isEmpty()) {
            send("game.ads", "{\"ready\":false,\"off\":true}");
            return;
        }
        askConsentThenStart();
    }

    static void openPrivacyOptions() {
        // 改完同意重新判断：原来不同意、现在同意了就初始化并拉广告。表单打不开（没网、这个地区不需要）回给脚本提示
        UserMessagingPlatform.showPrivacyOptionsForm(activity, error -> {
            send("game.privacy", error == null ? "{\"ok\":true}" : "{\"ok\":false}");
            ConsentInformation info = UserMessagingPlatform.getConsentInformation(activity);
            sendConsent(info);
            startSdk(info);
        });
    }

    /** game.consent：这个用户要不要「隐私选项」入口（UMP 说需要才给，欧洲等地） */
    private static void sendConsent(ConsentInformation info) {
        boolean required = info.getPrivacyOptionsRequirementStatus() == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
        send("game.consent", required ? "{\"privacy\":true}" : "{\"privacy\":false}");
    }

    private static void askConsentThenStart() {
        ConsentInformation info = UserMessagingPlatform.getConsentInformation(activity);
        ConsentRequestParameters params = new ConsentRequestParameters.Builder().build();
        info.requestConsentInfoUpdate(activity, params,
            () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity, formError -> {
                consentRetry = RETRY_FIRST;
                if (formError != null) reportFail("consent_form", formError.getErrorCode(), formError.getMessage());
                sendConsent(info);
                startSdk(info);
            }),
            requestError -> {
                reportFail("consent", requestError.getErrorCode(), requestError.getMessage());
                sendConsent(info);
                startSdk(info);
                // 问同意本身失败了（第一次打开时连不上 Google 等）：同意状态停在「未知」、请求不了广告。
                // 不再问的话这一局广告入口一直是灰的，要杀掉重开；隔一会儿再问，间隔和拉广告失败的重试一样
                if (!info.canRequestAds()) {
                    int wait = consentRetry;
                    consentRetry = Math.min(RETRY_MAX, consentRetry * 2);
                    main.postDelayed(GameAds::askConsentThenStart, wait * 1000L);
                }
            });
    }

    private static void startSdk(ConsentInformation info) {
        if (!info.canRequestAds()) {
            // 用户没同意：这次请求不了广告，入口变灰；设置里的「隐私选项」还能改。
            // consent:false 让脚本那头插屏、横幅也停，之前发出的加载请求晚到的 ready 也不算（fishsort #215）
            send("game.ads", "{\"ready\":false,\"consent\":false}");
            return;
        }
        MobileAds.initialize(activity, status -> {
            // SDK 起来了：插屏、横幅从这时起就能请求，不用等激励视频加载好（激励一直拉不到时插屏、横幅原来也被挡着）
            send("game.ads", "{\"ready\":false,\"started\":true}");
            loadRewarded();
            loadInterstitial();
        });
    }

    /** 拉广告失败：告诉脚本是哪种广告、错误码，脚本记一条埋点（ad_load_fail），查「为什么没有广告」用 */
    private static void reportFail(String format, LoadAdError error) {
        reportFail(format, error.getCode(), error.getMessage());
    }

    /** format 还有 consent（问同意失败）、consent_form（同意弹窗出错） */
    private static void reportFail(String format, int code, String message) {
        String msg = JSONObject.quote(message == null ? "" : message);
        send("game.adfail", "{\"format\":\"" + format + "\",\"code\":" + code + ",\"msg\":" + msg + "}");
    }

    private static boolean rewardedLoading;
    private static boolean interstitialLoading;

    private static void loadRewarded() {
        // 已经有一条或正在加载就不重复请求（点了入口、到点重试可能同时触发）
        if (rewardedUnit.isEmpty() || rewarded != null || rewardedLoading) return;
        // 同意被收回后，排队的重试不再发请求（fishsort #215）
        if (!UserMessagingPlatform.getConsentInformation(activity).canRequestAds()) return;
        rewardedLoading = true;
        RewardedAd.load(activity, rewardedUnit, new AdRequest.Builder().build(), new RewardedAdLoadCallback() {
            @Override
            public void onAdLoaded(@NonNull RewardedAd ad) {
                rewardedLoading = false;
                rewarded = ad;
                rewardedRetry = RETRY_FIRST;
                rewarded.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdDismissedFullScreenContent() {
                        send("game.rewarded", earned ? "{\"result\":\"done\"}" : "{\"result\":\"skipped\"}");
                        rewarded = null;
                        send("game.ads", "{\"ready\":false}");
                        loadRewarded();
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(@NonNull AdError error) {
                        send("game.rewarded", "{\"result\":\"unavailable\"}");
                        rewarded = null;
                        send("game.ads", "{\"ready\":false}");
                        loadRewarded();
                    }
                });
                send("game.ads", "{\"ready\":true}");
            }

            @Override
            public void onAdFailedToLoad(@NonNull LoadAdError error) {
                rewardedLoading = false;
                rewarded = null;
                send("game.ads", "{\"ready\":false}");
                reportFail("rewarded", error);
                int wait = rewardedRetry;
                rewardedRetry = Math.min(RETRY_MAX, rewardedRetry * 2);
                main.postDelayed(GameAds::loadRewarded, wait * 1000L);
            }
        });
    }

    private static void loadInterstitial() {
        if (interstitialUnit.isEmpty() || interstitial != null || interstitialLoading) return;
        if (!UserMessagingPlatform.getConsentInformation(activity).canRequestAds()) return;
        interstitialLoading = true;
        InterstitialAd.load(activity, interstitialUnit, new AdRequest.Builder().build(), new InterstitialAdLoadCallback() {
            @Override
            public void onAdLoaded(@NonNull InterstitialAd ad) {
                interstitialLoading = false;
                interstitial = ad;
                interstitialRetry = RETRY_FIRST;
                interstitial.setFullScreenContentCallback(new FullScreenContentCallback() {
                    @Override
                    public void onAdDismissedFullScreenContent() {
                        send("game.interstitial", "{\"shown\":true}");
                        interstitial = null;
                        loadInterstitial();
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(@NonNull AdError error) {
                        send("game.interstitial", "{\"shown\":false}");
                        interstitial = null;
                        loadInterstitial();
                    }
                });
            }

            @Override
            public void onAdFailedToLoad(@NonNull LoadAdError error) {
                interstitialLoading = false;
                interstitial = null;
                reportFail("interstitial", error);
                int wait = interstitialRetry;
                interstitialRetry = Math.min(RETRY_MAX, interstitialRetry * 2);
                main.postDelayed(GameAds::loadInterstitial, wait * 1000L);
            }
        });
    }

    static void showRewarded() {
        if (rewarded == null) {
            send("game.rewarded", "{\"result\":\"unavailable\"}");
            loadRewarded();
            return;
        }
        earned = false;
        rewarded.show(activity, reward -> earned = true);
    }

    static void showInterstitial() {
        if (interstitial == null) {
            send("game.interstitial", "{\"shown\":false}");
            loadInterstitial();
            return;
        }
        interstitial.show(activity);
    }

    static void setBannerVisible(boolean show) {
        if (bannerUnit.isEmpty()) return;
        if (show && banner == null) {
            DisplayMetrics dm = activity.getResources().getDisplayMetrics();
            int widthDp = (int) (dm.widthPixels / dm.density);
            banner = new AdView(activity);
            banner.setAdUnitId(bannerUnit);
            banner.setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, widthDp));
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
            activity.addContentView(banner, lp);
            banner.loadAd(new AdRequest.Builder().build());
        }
        if (banner != null) banner.setVisibility(show ? View.VISIBLE : View.GONE);
    }
}
