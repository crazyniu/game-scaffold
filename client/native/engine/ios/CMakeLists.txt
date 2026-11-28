cmake_minimum_required(VERSION 3.8)

set(CMAKE_SYSTEM_NAME iOS)
set(APP_NAME "MyGame"  CACHE STRING "Project Name")

project(${APP_NAME} CXX)

set(CC_PROJECT_DIR ${CMAKE_CURRENT_LIST_DIR})
set(CC_UI_RESOURCES)
set(CC_PROJ_SOURCES)
set(CC_ASSET_FILES)
set(CC_COMMON_SOURCES)
set(CC_ALL_SOURCES)

include(${CC_PROJECT_DIR}/../common/CMakeLists.txt)
set(EXECUTABLE_NAME ${APP_NAME}-mobile)

# 我们自己的原生代码：脚本和原生之间的桥（docs/04 第 5 节）
list(APPEND CC_PROJ_SOURCES
    ${CC_PROJECT_DIR}/SceneDelegate.h
    ${CC_PROJECT_DIR}/SceneDelegate.mm
    ${CC_PROJECT_DIR}/game/GameBridge.h
    ${CC_PROJECT_DIR}/game/GameBridge.mm
)

cc_ios_before_target(${EXECUTABLE_NAME})
add_executable(${EXECUTABLE_NAME} ${CC_ALL_SOURCES})
cc_ios_after_target(${EXECUTABLE_NAME})

# 各语言的应用名（<语言>.lproj/InfoPlist.strings，tools/native/apply.mjs 按 game.json 生成）。
# Cocos 的模板只把 Base.lproj 里的启动屏和 Localizable.strings 打进包；列进资源表又会被摊平到包根目录、同名文件互相覆盖，
# 所以构建完（签名之前）按目录拷进 .app。GAME_LPROJ 由 apply.mjs 改写
# 构建完往 .app 里拷东西一律走 game_copy_into_app：拷到 Xcode 正在打的那个 App（copy-into-app.sh）。
# 不能直接拷到 $<TARGET_BUNDLE_DIR>：归档（IPA）时 App 不在那里，归档里就缺文件（fishsort 1.0.0（4）因此缺 Firebase 配置、启动即崩）
function(game_copy_into_app src rel)
    add_custom_command(TARGET ${EXECUTABLE_NAME} POST_BUILD
        COMMAND /bin/sh "${CC_PROJECT_DIR}/copy-into-app.sh" "$<TARGET_BUNDLE_DIR:${EXECUTABLE_NAME}>" "${src}" "${rel}")
endfunction()
set(GAME_LPROJ Base en zh-Hans zh-Hant ja ko de fr es pt-BR it ru tr)
foreach(d ${GAME_LPROJ})
    game_copy_into_app("${CC_PROJECT_DIR}/${d}.lproj/InfoPlist.strings" "${d}.lproj/InfoPlist.strings")
endforeach()
# 隐私清单（App Store 要求：用到 UserDefaults、文件时间、开机时间这几类 API 要写明理由）：同样构建完拷进 .app 根目录
game_copy_into_app("${CC_PROJECT_DIR}/PrivacyInfo.xcprivacy" "PrivacyInfo.xcprivacy")

# Xcode 27 的 libc++ 不许特化 std::is_floating_point 等（引擎带的 enoki/half.h 这么做了），这条诊断默认是错误，降成警告
foreach(t cocos_engine ${EXECUTABLE_NAME})
    if(TARGET ${t})
        target_compile_options(${t} PRIVATE -Wno-invalid-specialization)
    endif()
endforeach()

# Cocos 3.8.8 预编译的 libwebp.a 成员没按 8 字节对齐，Xcode 27 的新链接器会丢掉它们、链接失败。
# ./package.sh 选择 iOS 时 用 Xcode 的 libtool 重新打包一份对齐的放到 sdk/libwebp/（不进仓库），这里把引擎的 webp 目标指过去
if(TARGET webp AND EXISTS ${CC_PROJECT_DIR}/sdk/libwebp/libwebp.a)
    set_target_properties(webp PROPERTIES IMPORTED_LOCATION ${CC_PROJECT_DIR}/sdk/libwebp/libwebp.a)
endif()

# 只做 iPhone 版（docs/06 第 3 节），在 iPad 上按 iPhone 比例运行
set_target_properties(${EXECUTABLE_NAME} PROPERTIES XCODE_ATTRIBUTE_TARGETED_DEVICE_FAMILY "1")

# 原生 SDK：./package.sh 选择 iOS 时下载到 sdk/（不进仓库），按 game.json 的开关链进来。两样都由 tools/native/apply.mjs 改写：
#   GAME_ADS       广告（Google Mobile Ads + UMP，sdk/ 下），game.json 的 ads.enabled
#   GAME_FIREBASE  统计 + 崩溃报告（Firebase Analytics + Crashlytics，sdk/firebase/ 下），game.json 的 firebase.enabled 并且放了 GoogleService-Info.plist
# 没下载、或者开关关着时不链，桥里按没有这样东西编译（GameBridge.mm 的 __has_include）
set(GAME_ADS ON)
set(GAME_FIREBASE OFF)
set(GAME_SDK_DIR ${CC_PROJECT_DIR}/sdk)
set(GAME_XCFRAMEWORKS "")
set(GAME_LINK "")
if(GAME_ADS AND EXISTS ${GAME_SDK_DIR}/GoogleMobileAds.xcframework)
    list(APPEND GAME_XCFRAMEWORKS ${GAME_SDK_DIR}/GoogleMobileAds.xcframework ${GAME_SDK_DIR}/UserMessagingPlatform.xcframework)
    list(APPEND GAME_LINK
        "-framework GoogleMobileAds"
        "-framework UserMessagingPlatform"
        "-framework AppTrackingTransparency"
        "-framework JavaScriptCore"
        "-framework StoreKit"
        "-framework WebKit"
    )
endif()
set(GAME_FIREBASE_DIR ${GAME_SDK_DIR}/firebase)
if(GAME_FIREBASE AND EXISTS ${GAME_FIREBASE_DIR}/FirebaseCore.xcframework AND EXISTS ${CC_PROJECT_DIR}/GoogleService-Info.plist)
    # Firebase.zip 的 METADATA.md：Analytics 要的一组 + Crashlytics 要的一组。广告 ID 支持（IdentitySupport）只在有广告时带：
    # 没有广告就不碰广告 ID，App Store 的隐私问卷、跟踪授权都不用为它填
    set(GAME_FIREBASE_FWS
        FBLPromises FirebaseAnalytics FirebaseCore FirebaseCoreInternal FirebaseInstallations GoogleAdsOnDeviceConversion
        GoogleAppMeasurement GoogleUtilities nanopb
        FirebaseCoreExtension FirebaseCrashlytics FirebaseRemoteConfigInterop FirebaseSessions GoogleDataTransport)
    if(GAME_ADS)
        list(APPEND GAME_FIREBASE_FWS GoogleAppMeasurementIdentitySupport)
    endif()
    foreach(fw ${GAME_FIREBASE_FWS})
        list(APPEND GAME_XCFRAMEWORKS ${GAME_FIREBASE_DIR}/${fw}.xcframework)
        list(APPEND GAME_LINK "-framework ${fw}")
        # 静态库的隐私清单在各自的 <名字>_Privacy.bundle 里，要放进 .app 才算数（App Store 查第三方 SDK 的隐私清单）
        file(GLOB GAME_PRIVACY_BUNDLES LIST_DIRECTORIES true "${GAME_FIREBASE_DIR}/${fw}.xcframework/ios-arm64/*.framework/*_Privacy.bundle")
        foreach(b ${GAME_PRIVACY_BUNDLES})
            get_filename_component(bn ${b} NAME)
            game_copy_into_app("${b}" "${bn}")
        endforeach()
    endforeach()
    list(APPEND GAME_LINK "-lc++" "-lsqlite3" "-lz")
    # Firebase 启动时读包里的 GoogleService-Info.plist（apply.mjs 从仓库根目录的 firebase/ 拷过来）
    game_copy_into_app("${CC_PROJECT_DIR}/GoogleService-Info.plist" "GoogleService-Info.plist")
    # 崩溃堆栈要 dSYM 才看得懂：Cocos 的 Release 配置不带调试信息（GCC_GENERATE_DEBUGGING_SYMBOLS = NO），引擎和游戏都打开，
    # 上架包（Release）生成 dSYM，./package.sh 打完 IPA 传给 Crashlytics。调试信息只进 dSYM，装进手机的包照样去掉符号
    foreach(t cocos_engine ${EXECUTABLE_NAME})
        if(TARGET ${t})
            set_target_properties(${t} PROPERTIES
                XCODE_ATTRIBUTE_GCC_GENERATE_DEBUGGING_SYMBOLS[variant=Release] "YES"
                XCODE_ATTRIBUTE_DEBUG_INFORMATION_FORMAT[variant=Release] "dwarf-with-dsym")
        endif()
    endforeach()
endif()

if(GAME_XCFRAMEWORKS)
    # CMake 3.24 不能直接链 xcframework，按真机 / 模拟器分别指到各自的切片目录
    set(GAME_DEVICE_PATHS "")
    set(GAME_SIM_PATHS "")
    foreach(xc ${GAME_XCFRAMEWORKS})
        file(GLOB GAME_DEVICE_SLICE LIST_DIRECTORIES true "${xc}/ios-arm64")
        file(GLOB GAME_SIM_SLICE LIST_DIRECTORIES true "${xc}/ios-*simulator")
        list(APPEND GAME_DEVICE_PATHS ${GAME_DEVICE_SLICE})
        list(APPEND GAME_SIM_PATHS ${GAME_SIM_SLICE})
    endforeach()
    string(REPLACE ";" " " GAME_DEVICE_PATHS "${GAME_DEVICE_PATHS}")
    string(REPLACE ";" " " GAME_SIM_PATHS "${GAME_SIM_PATHS}")
    set_target_properties(${EXECUTABLE_NAME} PROPERTIES
        XCODE_ATTRIBUTE_FRAMEWORK_SEARCH_PATHS[sdk=iphoneos*] "$(inherited) ${GAME_DEVICE_PATHS}"
        XCODE_ATTRIBUTE_FRAMEWORK_SEARCH_PATHS[sdk=iphonesimulator*] "$(inherited) ${GAME_SIM_PATHS}"
    )
    # 这些 SDK 里有 Swift 代码：工程里没有 Swift 文件，Xcode 不会自动链 Swift 运行时，手动加搜索路径和三个兼容库
    # （CMake 3.24 在 Xcode 27 下 enable_language(Swift) 找不到编译器，只能这样）
    set_target_properties(${EXECUTABLE_NAME} PROPERTIES
        XCODE_ATTRIBUTE_LIBRARY_SEARCH_PATHS "$(inherited) $(SDKROOT)/usr/lib/swift $(TOOLCHAIN_DIR)/usr/lib/swift/$(PLATFORM_NAME)"
        XCODE_ATTRIBUTE_LD_RUNPATH_SEARCH_PATHS "$(inherited) /usr/lib/swift @executable_path/Frameworks"
    )
    target_link_libraries(${EXECUTABLE_NAME}
        "-lswiftCompatibility51"
        "-lswiftCompatibility56"
        "-lswiftCompatibilityConcurrency"
        "-ObjC"
        ${GAME_LINK}
    )
endif()
