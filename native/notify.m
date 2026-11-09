// Actionable macOS notifications for Focus Timer.
//
// Electrobun's showNotification can't carry buttons or report clicks, so this
// small library talks to UNUserNotificationCenter itself and is loaded from
// the Bun process with bun:ffi (see src/bun/notify.ts).
//
// Threading: every function is called from Bun's JS thread and returns right
// away; UI work hops to the main queue. Results come back through one
// callback that Bun registers as a threadsafe JSCallback, so it only ever
// carries plain integers (no pointers whose lifetime we'd have to manage).
//
// Build: scripts/build-native.ts (clang, no Xcode project).

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

// event 1: a notification was answered. a = kind (set when posting),
//          b = action code (0 = the notification itself was clicked).
// event 2: permission. a = 0 not asked yet, 1 denied, 2 allowed.
typedef void (*FTCallback)(int32_t event, int32_t a, int32_t b);

static FTCallback gCallback = NULL;
static NSMutableDictionary<NSString *, UNNotificationCategory *> *gCategories = nil;

static void emit(int32_t event, int32_t a, int32_t b) {
	FTCallback cb = gCallback;
	if (cb) cb(event, a, b);
}

static NSString *str(const char *s) {
	return s ? [NSString stringWithUTF8String:s] : @"";
}

static void reportPermission(void) {
	[[UNUserNotificationCenter currentNotificationCenter]
		getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
			int32_t v = 2;
			if (settings.authorizationStatus == UNAuthorizationStatusNotDetermined) v = 0;
			else if (settings.authorizationStatus == UNAuthorizationStatusDenied) v = 1;
			emit(2, v, 0);
		}];
}

@interface FTNotifyDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation FTNotifyDelegate

// Show banners even while Focus Timer is the frontmost app.
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
	completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList |
	                  UNNotificationPresentationOptionSound);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
    didReceiveNotificationResponse:(UNNotificationResponse *)response
             withCompletionHandler:(void (^)(void))completionHandler {
	NSNumber *kind = response.notification.request.content.userInfo[@"kind"];
	NSString *action = response.actionIdentifier;
	int32_t code = -1;
	if ([action isEqualToString:UNNotificationDefaultActionIdentifier]) {
		code = 0;
	} else if ([action hasPrefix:@"a"]) {
		code = (int32_t)[[action substringFromIndex:1] intValue];
	}
	if (code >= 0) emit(1, kind ? kind.intValue : 0, code);
	completionHandler();
}

@end

static FTNotifyDelegate *gDelegate = nil;

// Returns 0 when notifications can't work here (no app bundle, e.g. `bun run`).
int32_t ft_notify_init(FTCallback cb) {
	if (NSBundle.mainBundle.bundleIdentifier == nil) return 0;
	gCallback = cb;
	dispatch_async(dispatch_get_main_queue(), ^{
		gCategories = [NSMutableDictionary new];
		gDelegate = [FTNotifyDelegate new];
		[UNUserNotificationCenter currentNotificationCenter].delegate = gDelegate;
		reportPermission();
	});
	return 1;
}

void ft_notify_request(void) {
	[[UNUserNotificationCenter currentNotificationCenter]
		requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound)
		              completionHandler:^(BOOL granted, NSError *error) {
			              reportPermission();
		              }];
}

void ft_notify_refresh(void) {
	reportPermission();
}

// Up to two buttons per category. Codes must be > 0; a code of 0 skips the slot.
void ft_notify_category(const char *ident, int32_t code1, const char *title1, int32_t code2,
                        const char *title2) {
	NSString *catId = str(ident);
	NSMutableArray<UNNotificationAction *> *actions = [NSMutableArray new];
	if (code1 > 0) {
		[actions addObject:[UNNotificationAction actionWithIdentifier:[NSString stringWithFormat:@"a%d", code1]
		                                                         title:str(title1)
		                                                       options:UNNotificationActionOptionNone]];
	}
	if (code2 > 0) {
		[actions addObject:[UNNotificationAction actionWithIdentifier:[NSString stringWithFormat:@"a%d", code2]
		                                                         title:str(title2)
		                                                       options:UNNotificationActionOptionNone]];
	}
	UNNotificationCategory *category = [UNNotificationCategory categoryWithIdentifier:catId
	                                                                          actions:actions
	                                                                intentIdentifiers:@[]
	                                                                          options:UNNotificationCategoryOptionNone];
	dispatch_async(dispatch_get_main_queue(), ^{
		if (!gCategories) gCategories = [NSMutableDictionary new];
		gCategories[catId] = category;
		[[UNUserNotificationCenter currentNotificationCenter]
			setNotificationCategories:[NSSet setWithArray:gCategories.allValues]];
	});
}

// Posting with an identifier that's already showing replaces it.
void ft_notify_post(const char *ident, const char *category, const char *title, const char *body,
                    int32_t kind, int32_t sound) {
	UNMutableNotificationContent *content = [UNMutableNotificationContent new];
	content.title = str(title);
	content.body = str(body);
	content.categoryIdentifier = str(category);
	content.userInfo = @{@"kind" : @(kind)};
	if (sound) content.sound = [UNNotificationSound defaultSound];
	UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:str(ident)
	                                                                      content:content
	                                                                      trigger:nil];
	[[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request
	                                                       withCompletionHandler:^(NSError *error) {
		                                                       if (error) NSLog(@"Focus Timer notification failed: %@", error);
	                                                       }];
}

void ft_notify_remove(const char *ident) {
	NSArray<NSString *> *ids = @[ str(ident) ];
	UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
	[center removePendingNotificationRequestsWithIdentifiers:ids];
	[center removeDeliveredNotificationsWithIdentifiers:ids];
}
