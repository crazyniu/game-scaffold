// 脚本和 iOS 原生之间的桥（docs/04 第 5 节）：收 platformNative.ts 发来的 game.* 事件，调广告、统计、震动、分享。
#import <Foundation/Foundation.h>

@interface GameBridge : NSObject
/** AppDelegate 启动时调一次：注册事件 */
+ (void)setup;
@end
