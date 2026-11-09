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
// When macOS won't deliver notifications (the user turned them off, or the
// build isn't developer-signed so macOS refuses to ask), the same notices
// show as a small floating panel in the top-right corner instead. It has the
// same buttons and reports presses through the same callback, so Bun doesn't
// need to know which one the user saw.
//
// Build: scripts/build-native.ts (clang, no Xcode project).

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <UserNotifications/UserNotifications.h>

// event 1: a notification was answered. a = kind (set when posting),
//          b = action code (0 = the notification itself was clicked).
// event 2: permission. a = 0 not asked yet, 1 denied, 2 allowed,
//          3 blocked (macOS refused to ask: the app isn't developer-signed).
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

// Last known permission, same values as event 2. Anything but 2 means
// notices go to the panel. Written from UN's queues, read on the JS thread.
static _Atomic int32_t gAuth = 0;

static void setAuth(int32_t v) {
	// A later status check still says "not determined"; keep "blocked".
	if (v == 0 && gAuth == 3) return;
	gAuth = v;
	emit(2, v, 0);
}

static void reportPermission(void) {
	[[UNUserNotificationCenter currentNotificationCenter]
		getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
			int32_t v = 2;
			if (settings.authorizationStatus == UNAuthorizationStatusNotDetermined) v = 0;
			else if (settings.authorizationStatus == UNAuthorizationStatusDenied) v = 1;
			setAuth(v);
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
			              // Ad-hoc signed apps get this straight away, with no prompt,
			              // while the status stays "not determined". Say so, or the
			              // caller waits forever for an answer that won't come.
			              if (error && [error.domain isEqualToString:UNErrorDomain] &&
			                  error.code == UNErrorCodeNotificationsNotAllowed) {
				              setAuth(3);
				              return;
			              }
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

static void showPanel(NSString *ident, NSString *category, NSString *title, NSString *body, int32_t kind,
                      BOOL sound);
static void hidePanel(NSString *ident);

// Posting with an identifier that's already showing replaces it.
void ft_notify_post(const char *ident, const char *category, const char *title, const char *body,
                    int32_t kind, int32_t sound) {
	if (gAuth != 2) {
		showPanel(str(ident), str(category), str(title), str(body), kind, sound != 0);
		return;
	}
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
	hidePanel(str(ident));
	NSArray<NSString *> *ids = @[ str(ident) ];
	UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
	[center removePendingNotificationRequestsWithIdentifiers:ids];
	[center removeDeliveredNotificationsWithIdentifiers:ids];
}

// ── Panel ───────────────────────────────────────────────────────────────────
// Colours mirror the app's tokens (src/mainview/index.css). Text is SF, since
// Geist isn't installed system-wide.

static int32_t gTheme = 0; // 0 follow macOS, 1 dark, 2 light

static NSColor *rgb(int r, int g, int b) {
	return [NSColor colorWithSRGBRed:r / 255.0 green:g / 255.0 blue:b / 255.0 alpha:1];
}

static NSColor *tone(NSColor *light, NSColor *dark) {
	return [NSColor colorWithName:nil
	              dynamicProvider:^NSColor *(NSAppearance *a) {
		              BOOL isDark = [[a bestMatchFromAppearancesWithNames:@[
			              NSAppearanceNameAqua, NSAppearanceNameDarkAqua
		              ]] isEqualToString:NSAppearanceNameDarkAqua];
		              return isDark ? dark : light;
	              }];
}

static NSColor *ftSurface(void) { return tone(rgb(252, 252, 250), rgb(22, 22, 25)); }
static NSColor *ftLine(void) { return tone(rgb(222, 222, 216), rgb(44, 44, 50)); }
static NSColor *ftInk(void) { return tone(rgb(22, 22, 24), rgb(236, 236, 238)); }
static NSColor *ftSoft(void) { return tone(rgb(236, 236, 232), rgb(36, 36, 41)); }
static NSColor *ftSoftHover(void) { return tone(rgb(226, 226, 221), rgb(46, 46, 52)); }
static NSColor *ftAccent(void) { return tone(rgb(20, 158, 101), rgb(112, 230, 170)); }
static NSColor *ftAccentInk(void) { return tone(rgb(250, 255, 252), rgb(5, 28, 17)); }

static NSAppearance *panelAppearance(void) {
	if (gTheme == 1) return [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
	if (gTheme == 2) return [NSAppearance appearanceNamed:NSAppearanceNameAqua];
	return nil;
}

static BOOL reduceMotion(void) {
	return NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
}

static CAMediaTimingFunction *easeOut(void) {
	return [CAMediaTimingFunction functionWithControlPoints:0.22:1:0.36:1];
}

typedef NS_ENUM(NSInteger, FTPillStyle) { FTPillPrimary, FTPillSecondary, FTPillClose };

// A button drawn to match the app: hover, press and a pointing cursor.
@interface FTPill : NSView
@property(nonatomic) FTPillStyle style;
@property(nonatomic, copy) NSString *title;
@property(nonatomic, copy) void (^onPress)(void);
@property(nonatomic) BOOL hover;
@property(nonatomic) BOOL down;
@end

@implementation FTPill

- (BOOL)isFlipped {
	return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
	return YES;
}

- (void)updateTrackingAreas {
	[super updateTrackingAreas];
	for (NSTrackingArea *t in self.trackingAreas) [self removeTrackingArea:t];
	[self addTrackingArea:[[NSTrackingArea alloc]
	                          initWithRect:NSZeroRect
	                               options:NSTrackingMouseEnteredAndExited | NSTrackingCursorUpdate |
	                                       NSTrackingActiveAlways | NSTrackingInVisibleRect
	                                 owner:self
	                              userInfo:nil]];
}

- (void)cursorUpdate:(NSEvent *)event {
	[[NSCursor pointingHandCursor] set];
}

- (void)mouseEntered:(NSEvent *)event {
	self.hover = YES;
	[self setNeedsDisplay:YES];
}

- (void)mouseExited:(NSEvent *)event {
	self.hover = NO;
	self.down = NO;
	[self setNeedsDisplay:YES];
}

- (void)mouseDown:(NSEvent *)event {
	self.down = YES;
	[self setNeedsDisplay:YES];
}

- (void)mouseDragged:(NSEvent *)event {
	BOOL inside = NSPointInRect([self convertPoint:event.locationInWindow fromView:nil], self.bounds);
	if (inside != self.down) {
		self.down = inside;
		[self setNeedsDisplay:YES];
	}
}

- (void)mouseUp:(NSEvent *)event {
	BOOL inside = NSPointInRect([self convertPoint:event.locationInWindow fromView:nil], self.bounds);
	self.down = NO;
	[self setNeedsDisplay:YES];
	if (inside && self.onPress) self.onPress();
}

- (void)drawRect:(NSRect)dirty {
	NSRect r = self.bounds;
	NSColor *fill = nil;
	NSColor *text = ftInk();
	if (self.style == FTPillPrimary) {
		fill = [ftAccent() colorWithAlphaComponent:self.down ? 0.78 : self.hover ? 0.88 : 1];
		text = ftAccentInk();
	} else if (self.style == FTPillSecondary) {
		fill = self.hover || self.down ? ftSoftHover() : ftSoft();
	} else if (self.hover || self.down) {
		fill = ftSoft();
	}
	if (fill) {
		[fill setFill];
		CGFloat radius = self.style == FTPillClose ? 5 : 7;
		[[NSBezierPath bezierPathWithRoundedRect:r xRadius:radius yRadius:radius] fill];
	}
	if (self.style == FTPillClose) {
		NSBezierPath *x = [NSBezierPath bezierPath];
		CGFloat m = NSMidX(r), n = NSMidY(r), d = 3.5;
		[x moveToPoint:NSMakePoint(m - d, n - d)];
		[x lineToPoint:NSMakePoint(m + d, n + d)];
		[x moveToPoint:NSMakePoint(m + d, n - d)];
		[x lineToPoint:NSMakePoint(m - d, n + d)];
		x.lineWidth = 1.4;
		x.lineCapStyle = NSLineCapStyleRound;
		[ftInk() setStroke];
		[x stroke];
		return;
	}
	NSMutableParagraphStyle *para = [NSMutableParagraphStyle new];
	para.alignment = NSTextAlignmentCenter;
	NSDictionary *attrs = @{
		NSFontAttributeName : [NSFont systemFontOfSize:12 weight:NSFontWeightSemibold],
		NSForegroundColorAttributeName : text,
		NSParagraphStyleAttributeName : para,
	};
	CGFloat h = [self.title sizeWithAttributes:attrs].height;
	[self.title drawInRect:NSMakeRect(0, (r.size.height - h) / 2, r.size.width, h) withAttributes:attrs];
}

- (BOOL)isAccessibilityElement {
	return YES;
}

- (NSAccessibilityRole)accessibilityRole {
	return NSAccessibilityButtonRole;
}

- (NSString *)accessibilityLabel {
	return self.style == FTPillClose ? @"Close" : self.title;
}

- (BOOL)accessibilityPerformPress {
	if (self.onPress) self.onPress();
	return YES;
}

@end

// The card: surface fill and a 1px line, no shadow. A click outside the
// buttons opens the app, like clicking a notification.
@interface FTCard : NSView
@property(nonatomic, copy) void (^onClick)(void);
@property(nonatomic, copy) void (^onHover)(BOOL inside);
@end

@implementation FTCard

- (BOOL)isFlipped {
	return YES;
}

- (BOOL)wantsUpdateLayer {
	return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
	return YES;
}

- (void)updateLayer {
	self.layer.cornerRadius = 8;
	self.layer.borderWidth = 1;
	self.layer.masksToBounds = YES;
	[self.effectiveAppearance performAsCurrentDrawingAppearance:^{
		self.layer.backgroundColor = ftSurface().CGColor;
		self.layer.borderColor = ftLine().CGColor;
	}];
}

- (void)updateTrackingAreas {
	[super updateTrackingAreas];
	for (NSTrackingArea *t in self.trackingAreas) [self removeTrackingArea:t];
	[self addTrackingArea:[[NSTrackingArea alloc]
	                          initWithRect:NSZeroRect
	                               options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways |
	                                       NSTrackingInVisibleRect
	                                 owner:self
	                              userInfo:nil]];
}

- (void)mouseEntered:(NSEvent *)event {
	if (self.onHover) self.onHover(YES);
}

- (void)mouseExited:(NSEvent *)event {
	if (self.onHover) self.onHover(NO);
}

- (void)mouseUp:(NSEvent *)event {
	if (self.onClick) self.onClick();
}

@end

// Never takes focus, so it can't pull you out of the call app.
@interface FTPanel : NSPanel
@property(nonatomic, copy) NSString *ident;
@property(nonatomic) NSInteger timerGen;
@property(nonatomic) NSTimeInterval lifetime; // 0 = stays until removed
@property(nonatomic) BOOL closing;
@end

@implementation FTPanel

- (BOOL)canBecomeKeyWindow {
	return NO;
}

- (BOOL)canBecomeMainWindow {
	return NO;
}

@end

static NSMutableArray<FTPanel *> *gPanels = nil;
static const CGFloat kPanelWidth = 264;
static const CGFloat kPanelMargin = 12;
static const CGFloat kPanelGap = 8;

static NSScreen *panelScreen(void) {
	NSPoint mouse = NSEvent.mouseLocation;
	for (NSScreen *screen in NSScreen.screens) {
		if (NSPointInRect(mouse, screen.frame)) return screen;
	}
	return NSScreen.mainScreen ?: NSScreen.screens.firstObject;
}

// Newest at the top, stacked downwards. Every panel slides to its place,
// which also takes over any entrance still running; `entering` is the new
// one, which slides in from the right edge (or just fades with reduced motion).
static void layoutPanels(FTPanel *entering) {
	NSRect area = panelScreen().visibleFrame;
	CGFloat top = NSMaxY(area) - kPanelMargin;
	BOOL still = reduceMotion();
	for (FTPanel *panel in gPanels.reverseObjectEnumerator) {
		if (panel.closing) continue;
		NSSize size = panel.frame.size;
		NSRect target = NSMakeRect(NSMaxX(area) - kPanelMargin - size.width, top - size.height, size.width, size.height);
		top -= size.height + kPanelGap;
		if (panel == entering) {
			[panel setFrame:still ? target : NSOffsetRect(target, 24, 0) display:NO];
			panel.alphaValue = 0;
			[panel orderFrontRegardless];
		}
		[NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
			ctx.duration = panel == entering ? (still ? 0.12 : 0.28) : (still ? 0 : 0.22);
			ctx.timingFunction = easeOut();
			[panel.animator setFrame:target display:YES];
			panel.animator.alphaValue = 1;
		}];
	}
}

static void closePanel(FTPanel *panel) {
	if (panel.closing) return;
	panel.closing = YES;
	panel.ignoresMouseEvents = YES;
	BOOL still = reduceMotion();
	NSRect out = NSOffsetRect(panel.frame, still ? 0 : 16, 0);
	[NSAnimationContext
		runAnimationGroup:^(NSAnimationContext *ctx) {
			ctx.duration = 0.16;
			ctx.timingFunction = easeOut();
			panel.animator.alphaValue = 0;
			if (!still) [panel.animator setFrame:out display:YES];
		}
		completionHandler:^{
			[panel orderOut:nil];
			[gPanels removeObject:panel];
		}];
	layoutPanels(nil);
}

static void armTimer(FTPanel *panel, NSTimeInterval after) {
	if (panel.lifetime <= 0) return;
	NSInteger gen = ++panel.timerGen;
	__weak FTPanel *weak = panel;
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(after * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
		FTPanel *p = weak;
		if (p && p.timerGen == gen) closePanel(p);
	});
}

static void showPanel(NSString *ident, NSString *category, NSString *title, NSString *body, int32_t kind,
                      BOOL sound) {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (!gPanels) gPanels = [NSMutableArray new];

		// Buttons come from the category, same as the notification would have.
		NSMutableArray<NSDictionary *> *actions = [NSMutableArray new];
		for (UNNotificationAction *a in gCategories[category].actions) {
			if (![a.identifier hasPrefix:@"a"]) continue;
			[actions addObject:@{
				@"code" : @([[a.identifier substringFromIndex:1] intValue]),
				@"title" : a.title,
			}];
		}

		CGFloat pad = 14, inner = kPanelWidth - pad * 2, closeSize = 20;
		NSTextField *titleLabel = [NSTextField wrappingLabelWithString:title];
		titleLabel.font = [NSFont systemFontOfSize:13 weight:NSFontWeightSemibold];
		titleLabel.textColor = ftInk();
		titleLabel.preferredMaxLayoutWidth = inner - closeSize - 6;
		NSSize titleSize = [titleLabel sizeThatFits:NSMakeSize(inner - closeSize - 6, CGFLOAT_MAX)];

		NSTextField *bodyLabel = [NSTextField wrappingLabelWithString:body];
		bodyLabel.font = [NSFont systemFontOfSize:12];
		bodyLabel.textColor = ftInk();
		bodyLabel.preferredMaxLayoutWidth = inner;
		NSSize bodySize = body.length ? [bodyLabel sizeThatFits:NSMakeSize(inner, CGFLOAT_MAX)] : NSZeroSize;

		CGFloat y = pad;
		titleLabel.frame = NSMakeRect(pad, y, inner - closeSize - 6, titleSize.height);
		y += titleSize.height;
		if (body.length) {
			y += 3;
			bodyLabel.frame = NSMakeRect(pad, y, inner, bodySize.height);
			y += bodySize.height;
		}
		CGFloat buttonsY = y + 12, buttonH = 28;
		if (actions.count) y = buttonsY + buttonH;
		CGFloat height = y + pad;

		FTPanel *panel = nil;
		for (FTPanel *p in gPanels) {
			if ([p.ident isEqualToString:ident] && !p.closing) panel = p;
		}
		BOOL fresh = panel == nil;
		if (fresh) {
			panel = [[FTPanel alloc] initWithContentRect:NSMakeRect(0, 0, kPanelWidth, height)
			                                   styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
			                                     backing:NSBackingStoreBuffered
			                                       defer:NO];
			panel.ident = ident;
			panel.opaque = NO;
			panel.backgroundColor = NSColor.clearColor;
			panel.hasShadow = NO;
			panel.level = NSStatusWindowLevel;
			panel.hidesOnDeactivate = NO;
			panel.releasedWhenClosed = NO;
			panel.becomesKeyOnlyIfNeeded = YES;
			panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
			                           NSWindowCollectionBehaviorFullScreenAuxiliary |
			                           NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle;
			panel.animationBehavior = NSWindowAnimationBehaviorNone;
			[gPanels addObject:panel];
		} else {
			[panel setFrame:NSMakeRect(panel.frame.origin.x, NSMaxY(panel.frame) - height, kPanelWidth, height)
			        display:NO];
		}
		panel.appearance = panelAppearance();
		// A prompt with two choices waits for an answer; the rest step aside.
		panel.lifetime = actions.count >= 2 ? 0 : actions.count == 1 ? 20 : 8;

		__weak FTPanel *weak = panel;
		void (^respond)(int32_t) = ^(int32_t code) {
			FTPanel *p = weak;
			if (!p || p.closing) return;
			closePanel(p);
			emit(1, kind, code);
		};

		FTCard *card = [[FTCard alloc] initWithFrame:NSMakeRect(0, 0, kPanelWidth, height)];
		card.wantsLayer = YES;
		card.onClick = ^{ respond(0); };
		card.onHover = ^(BOOL inside) {
			FTPanel *p = weak;
			if (!p) return;
			// Hold still while the pointer is on it.
			if (inside) p.timerGen++;
			else armTimer(p, 4);
		};
		[card addSubview:titleLabel];
		if (body.length) [card addSubview:bodyLabel];

		FTPill *close = [[FTPill alloc] initWithFrame:NSMakeRect(kPanelWidth - pad - closeSize + 4, pad - 2, closeSize, closeSize)];
		close.style = FTPillClose;
		close.onPress = ^{
			FTPanel *p = weak;
			if (p) closePanel(p);
		};
		[card addSubview:close];

		CGFloat bw = actions.count == 2 ? (inner - 8) / 2 : inner;
		for (NSUInteger i = 0; i < actions.count; i++) {
			FTPill *pill = [[FTPill alloc] initWithFrame:NSMakeRect(pad + i * (bw + 8), buttonsY, bw, buttonH)];
			// With two choices the first leads; a lone button stays quiet.
			pill.style = actions.count == 2 && i == 0 ? FTPillPrimary : FTPillSecondary;
			pill.title = actions[i][@"title"];
			int32_t code = [actions[i][@"code"] intValue];
			pill.onPress = ^{ respond(code); };
			[card addSubview:pill];
		}
		panel.contentView = card;

		layoutPanels(fresh ? panel : nil);
		armTimer(panel, panel.lifetime);
		if (sound) [[NSSound soundNamed:@"Glass"] play];
	});
}

static void hidePanel(NSString *ident) {
	dispatch_async(dispatch_get_main_queue(), ^{
		for (FTPanel *p in [gPanels copy]) {
			if ([p.ident isEqualToString:ident]) closePanel(p);
		}
	});
}

// 0 follow macOS, 1 dark, 2 light: the app's theme setting.
void ft_notify_theme(int32_t theme) {
	dispatch_async(dispatch_get_main_queue(), ^{
		gTheme = theme;
		for (FTPanel *p in gPanels) p.appearance = panelAppearance();
	});
}
