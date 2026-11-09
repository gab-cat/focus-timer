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
// It also watches the microphone for src/bun/index.ts: CoreAudio tells us
// when mic use may have changed, so Bun only scans then instead of polling
// (see "Microphone" below).
//
// Build: scripts/build-native.ts (clang, no Xcode project).

#import <AppKit/AppKit.h>
#import <CoreAudio/CoreAudio.h>
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <UserNotifications/UserNotifications.h>

// event 1: a notification was answered. a = kind (set when posting),
//          b = action code (0 = the notification itself was clicked).
// event 2: permission. a = 0 not asked yet, 1 denied, 2 allowed,
//          3 blocked (macOS refused to ask: the app isn't developer-signed).
// event 3: some app started or stopped using the microphone (no payload;
//          Bun scans to find out which).
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
                      BOOL sound, int32_t tone, int32_t seconds);
static void hidePanel(NSString *ident);

// Posting with an identifier that's already showing replaces it.
// tone (panel only): 0 neutral, 1 warn (paused), 2 accent (running).
// seconds (panel only): how long it stays, with a countdown bar; 0 = until removed.
void ft_notify_post(const char *ident, const char *category, const char *title, const char *body,
                    int32_t kind, int32_t sound, int32_t tone, int32_t seconds) {
	if (gAuth != 2) {
		showPanel(str(ident), str(category), str(title), str(body), kind, sound != 0, tone, seconds);
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

static NSColor *pair(NSColor *light, NSColor *dark) {
	return [NSColor colorWithName:nil
	              dynamicProvider:^NSColor *(NSAppearance *a) {
		              BOOL isDark = [[a bestMatchFromAppearancesWithNames:@[
			              NSAppearanceNameAqua, NSAppearanceNameDarkAqua
		              ]] isEqualToString:NSAppearanceNameDarkAqua];
		              return isDark ? dark : light;
	              }];
}

static NSColor *ftSurface(void) { return pair(rgb(252, 252, 250), rgb(22, 22, 25)); }
static NSColor *ftLine(void) { return pair(rgb(222, 222, 216), rgb(44, 44, 50)); }
static NSColor *ftInk(void) { return pair(rgb(22, 22, 24), rgb(236, 236, 238)); }
static NSColor *ftInk3(void) { return pair(rgb(138, 138, 144), rgb(104, 104, 112)); }
static NSColor *ftSoft(void) { return pair(rgb(236, 236, 232), rgb(36, 36, 41)); }
static NSColor *ftSoftHover(void) { return pair(rgb(226, 226, 221), rgb(46, 46, 52)); }

enum { FTToneNeutral = 0, FTToneWarn = 1, FTToneAccent = 2 };

// The status colour: --warn while paused, --accent while running.
static NSColor *toneColor(int32_t tone) {
	if (tone == FTToneWarn) return pair(rgb(190, 124, 18), rgb(242, 188, 92));
	if (tone == FTToneAccent) return pair(rgb(20, 158, 101), rgb(112, 230, 170));
	return ftInk();
}

// Text on a filled status-colour button.
static NSColor *toneInk(int32_t tone) {
	if (tone == FTToneWarn) return pair(rgb(255, 252, 245), rgb(40, 26, 4));
	if (tone == FTToneAccent) return pair(rgb(250, 255, 252), rgb(5, 28, 17));
	return ftSurface();
}

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

// A button drawn to match the app: hover, press and a pointing cursor.
// Filled ones take the panel's status colour.
@interface FTPill : NSView
@property(nonatomic) BOOL filled;
@property(nonatomic) int32_t tone;
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
	NSColor *fill, *text;
	if (self.filled) {
		fill = [toneColor(self.tone) colorWithAlphaComponent:self.down ? 0.78 : self.hover ? 0.88 : 1];
		text = toneInk(self.tone);
	} else {
		fill = self.hover || self.down ? ftSoftHover() : ftSoft();
		text = ftInk();
	}
	[fill setFill];
	[[NSBezierPath bezierPathWithRoundedRect:r xRadius:7 yRadius:7] fill];
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
	return self.title;
}

- (BOOL)accessibilityPerformPress {
	if (self.onPress) self.onPress();
	return YES;
}

@end

// A small status dot, like the one next to "Active" in the app.
@interface FTDot : NSView
@property(nonatomic) int32_t tone;
@end

@implementation FTDot

- (void)drawRect:(NSRect)dirty {
	[(self.tone == FTToneNeutral ? ftInk3() : toneColor(self.tone)) setFill];
	[[NSBezierPath bezierPathWithOvalInRect:self.bounds] fill];
}

@end

// Countdown along the bottom edge: drains from full to empty over the
// panel's lifetime, and freezes while the pointer is on the panel.
@interface FTBar : NSView
@property(nonatomic) int32_t tone;
@property(nonatomic, strong) CALayer *fill;
@end

@implementation FTBar

- (instancetype)initWithFrame:(NSRect)frame {
	if ((self = [super initWithFrame:frame])) {
		self.wantsLayer = YES;
		self.fill = [CALayer layer];
		self.fill.anchorPoint = CGPointMake(0, 0.5);
		self.fill.frame = NSRectToCGRect(self.bounds);
		[self.layer addSublayer:self.fill];
	}
	return self;
}

- (BOOL)wantsUpdateLayer {
	return YES;
}

- (void)updateLayer {
	[self.effectiveAppearance performAsCurrentDrawingAppearance:^{
		NSColor *c = self.tone == FTToneNeutral ? ftInk3() : toneColor(self.tone);
		self.layer.backgroundColor = [c colorWithAlphaComponent:0.16].CGColor;
		self.fill.backgroundColor = c.CGColor;
	}];
}

- (void)runFor:(NSTimeInterval)seconds {
	CABasicAnimation *a = [CABasicAnimation animationWithKeyPath:@"transform.scale.x"];
	a.fromValue = @1;
	a.toValue = @0;
	a.duration = seconds;
	a.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionLinear];
	self.fill.transform = CATransform3DMakeScale(0, 1, 1);
	[self.fill addAnimation:a forKey:@"countdown"];
}

- (void)setPaused:(BOOL)paused {
	CALayer *l = self.fill;
	if (paused && l.speed != 0) {
		CFTimeInterval t = [l convertTime:CACurrentMediaTime() fromLayer:nil];
		l.speed = 0;
		l.timeOffset = t;
	} else if (!paused && l.speed == 0) {
		CFTimeInterval frozenAt = l.timeOffset;
		l.speed = 1;
		l.timeOffset = 0;
		l.beginTime = 0;
		l.beginTime = [l convertTime:CACurrentMediaTime() fromLayer:nil] - frozenAt;
	}
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
@property(nonatomic) CFTimeInterval deadline;
@property(nonatomic) NSTimeInterval remaining;
@property(nonatomic) BOOL held;
@property(nonatomic, strong) FTBar *bar;
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
static const CGFloat kBarHeight = 3;

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
	panel.timerGen++;
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

// Close after `after` seconds unless re-armed or held first.
static void armTimer(FTPanel *panel, NSTimeInterval after) {
	if (panel.lifetime <= 0) return;
	NSInteger gen = ++panel.timerGen;
	panel.deadline = CACurrentMediaTime() + after;
	__weak FTPanel *weak = panel;
	dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(after * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
		FTPanel *p = weak;
		if (p && p.timerGen == gen) closePanel(p);
	});
}

// Pointer on the panel: stop the clock and the bar; off it: carry on from there.
static void holdPanel(FTPanel *panel, BOOL hold) {
	if (panel.lifetime <= 0 || panel.closing || hold == panel.held) return;
	panel.held = hold;
	if (hold) {
		panel.remaining = MAX(0, panel.deadline - CACurrentMediaTime());
		panel.timerGen++;
		[panel.bar setPaused:YES];
	} else {
		[panel.bar setPaused:NO];
		armTimer(panel, MAX(0.8, panel.remaining));
	}
}

static void showPanel(NSString *ident, NSString *category, NSString *title, NSString *body, int32_t kind,
                      BOOL sound, int32_t tone, int32_t seconds) {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (!gPanels) gPanels = [NSMutableArray new];

		// Buttons from the category, same as the notification would have,
		// then Dismiss. The first one is filled with the status colour.
		NSMutableArray<NSDictionary *> *buttons = [NSMutableArray new];
		for (UNNotificationAction *a in gCategories[category].actions) {
			if (![a.identifier hasPrefix:@"a"]) continue;
			[buttons addObject:@{
				@"code" : @([[a.identifier substringFromIndex:1] intValue]),
				@"title" : a.title,
			}];
		}
		[buttons addObject:@{@"code" : @(-1), @"title" : @"Dismiss"}];

		CGFloat pad = 14, inner = kPanelWidth - pad * 2, dot = 7, textX = pad + dot + 8;
		CGFloat textW = kPanelWidth - textX - pad;
		NSTextField *titleLabel = [NSTextField wrappingLabelWithString:title];
		titleLabel.font = [NSFont systemFontOfSize:13 weight:NSFontWeightSemibold];
		titleLabel.textColor = ftInk();
		titleLabel.preferredMaxLayoutWidth = textW;
		NSSize titleSize = [titleLabel sizeThatFits:NSMakeSize(textW, CGFLOAT_MAX)];

		NSTextField *bodyLabel = [NSTextField wrappingLabelWithString:body];
		bodyLabel.font = [NSFont systemFontOfSize:12];
		bodyLabel.textColor = ftInk();
		bodyLabel.preferredMaxLayoutWidth = textW;
		NSSize bodySize = body.length ? [bodyLabel sizeThatFits:NSMakeSize(textW, CGFLOAT_MAX)] : NSZeroSize;

		CGFloat y = pad;
		titleLabel.frame = NSMakeRect(textX, y, textW, titleSize.height);
		// Centre the dot on the title's first line.
		CGFloat dotY = y + (titleLabel.font.ascender - titleLabel.font.descender) / 2 - dot / 2 + 1;
		y += titleSize.height;
		if (body.length) {
			y += 2;
			bodyLabel.frame = NSMakeRect(textX, y, textW, bodySize.height);
			y += bodySize.height;
		}
		CGFloat buttonsY = y + 12, buttonH = 28;
		y = buttonsY + buttonH;
		BOOL timed = seconds > 0;
		CGFloat height = y + pad + (timed ? kBarHeight : 0);

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
		panel.lifetime = seconds;
		panel.held = NO;

		__weak FTPanel *weak = panel;
		void (^respond)(int32_t) = ^(int32_t code) {
			FTPanel *p = weak;
			if (!p || p.closing) return;
			closePanel(p);
			if (code >= 0) emit(1, kind, code);
		};

		FTCard *card = [[FTCard alloc] initWithFrame:NSMakeRect(0, 0, kPanelWidth, height)];
		card.wantsLayer = YES;
		card.onClick = ^{ respond(0); };
		card.onHover = ^(BOOL inside) {
			FTPanel *p = weak;
			if (p) holdPanel(p, inside);
		};

		FTDot *dotView = [[FTDot alloc] initWithFrame:NSMakeRect(pad, dotY, dot, dot)];
		dotView.tone = tone;
		[card addSubview:dotView];
		[card addSubview:titleLabel];
		if (body.length) [card addSubview:bodyLabel];

		NSUInteger count = buttons.count;
		CGFloat bw = (inner - 8 * (count - 1)) / count;
		for (NSUInteger i = 0; i < count; i++) {
			FTPill *pill = [[FTPill alloc] initWithFrame:NSMakeRect(pad + i * (bw + 8), buttonsY, bw, buttonH)];
			// Neutral notices keep Dismiss quiet; colour is for status.
			pill.filled = i == 0 && (tone != FTToneNeutral || count > 1);
			pill.tone = tone;
			pill.title = buttons[i][@"title"];
			int32_t code = [buttons[i][@"code"] intValue];
			pill.onPress = ^{ respond(code); };
			[card addSubview:pill];
		}

		panel.bar = nil;
		if (timed) {
			FTBar *bar = [[FTBar alloc] initWithFrame:NSMakeRect(0, height - kBarHeight, kPanelWidth, kBarHeight)];
			bar.tone = tone;
			[card addSubview:bar];
			panel.bar = bar;
		}
		panel.contentView = card;

		layoutPanels(fresh ? panel : nil);
		if (timed) {
			[panel.bar runFor:seconds];
			armTimer(panel, seconds);
		} else {
			panel.timerGen++;
		}
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

// ── Microphone ──────────────────────────────────────────────────────────────
// Sends event 3 whenever mic use might have changed, so Bun scans only then.
// Signals, all pushed by CoreAudio with no polling:
// - an input device starts or stops running for any app (fires within ~50ms);
// - the list of audio client processes changes (an app opens audio);
// - devices are added or removed (a headset plugged in), which also re-syncs
//   the device listeners.
// macOS also has a per-process "is running input" flag, but it never sends
// change notifications, so it's only read when Bun scans (src/bun/mic.ts).
// Listeners run on their own serial queue; nothing runs while the mic is idle.

static const AudioObjectPropertyAddress kProcessList = {
	'prs#', // kAudioHardwarePropertyProcessObjectList (macOS 14.2+)
	kAudioObjectPropertyScopeGlobal,
	kAudioObjectPropertyElementMain,
};
static const AudioObjectPropertyAddress kDeviceList = {
	kAudioHardwarePropertyDevices,
	kAudioObjectPropertyScopeGlobal,
	kAudioObjectPropertyElementMain,
};
static const AudioObjectPropertyAddress kDeviceRunning = {
	kAudioDevicePropertyDeviceIsRunningSomewhere,
	kAudioObjectPropertyScopeGlobal,
	kAudioObjectPropertyElementMain,
};
static const AudioObjectPropertyAddress kInputStreams = {
	kAudioDevicePropertyStreams,
	kAudioObjectPropertyScopeInput,
	kAudioObjectPropertyElementMain,
};

static dispatch_queue_t gMicQueue = nil;
static AudioObjectPropertyListenerBlock gMicChanged = nil;
static AudioObjectPropertyListenerBlock gDevicesChanged = nil;
static NSMutableSet<NSNumber *> *gWatchedDevices = nil;
static BOOL gMicOn = NO;

// On gMicQueue: listen to input devices that appeared, drop ones that left.
static void syncDeviceListeners(void) {
	UInt32 size = 0;
	if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &kDeviceList, 0, NULL, &size) != noErr) return;
	NSMutableData *buf = [NSMutableData dataWithLength:MAX(size, sizeof(AudioObjectID))];
	if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &kDeviceList, 0, NULL, &size, buf.mutableBytes) != noErr)
		return;
	const AudioObjectID *ids = buf.bytes;
	NSMutableSet<NSNumber *> *now = [NSMutableSet set];
	for (UInt32 i = 0; i < size / sizeof(AudioObjectID); i++) {
		UInt32 streams = 0;
		// Output-only devices would fire for every sound played; skip them.
		if (AudioObjectGetPropertyDataSize(ids[i], &kInputStreams, 0, NULL, &streams) != noErr || streams == 0) continue;
		NSNumber *dev = @(ids[i]);
		[now addObject:dev];
		if (![gWatchedDevices containsObject:dev])
			AudioObjectAddPropertyListenerBlock(ids[i], &kDeviceRunning, gMicQueue, gMicChanged);
	}
	for (NSNumber *dev in gWatchedDevices) {
		// Usually already gone with the device; the error doesn't matter.
		if (![now containsObject:dev])
			AudioObjectRemovePropertyListenerBlock(dev.unsignedIntValue, &kDeviceRunning, gMicQueue, gMicChanged);
	}
	gWatchedDevices = now;
}

// 1 = watching (or stopped), 0 = not supported here, so Bun should poll.
int32_t ft_mic_watch(int32_t on) {
	UInt32 size = 0;
	// Without per-process objects Bun can't tell who holds the mic; it polls
	// the default device instead.
	if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &kProcessList, 0, NULL, &size) != noErr) return 0;
	if (!gMicQueue) {
		gMicQueue = dispatch_queue_create("focustimer.mic", DISPATCH_QUEUE_SERIAL);
		gMicChanged = ^(UInt32 n, const AudioObjectPropertyAddress *addrs) {
			emit(3, 0, 0);
		};
		gDevicesChanged = ^(UInt32 n, const AudioObjectPropertyAddress *addrs) {
			syncDeviceListeners();
			emit(3, 0, 0);
		};
	}
	dispatch_async(gMicQueue, ^{
		if (on && !gMicOn) {
			gMicOn = YES;
			gWatchedDevices = [NSMutableSet set];
			AudioObjectAddPropertyListenerBlock(kAudioObjectSystemObject, &kProcessList, gMicQueue, gMicChanged);
			AudioObjectAddPropertyListenerBlock(kAudioObjectSystemObject, &kDeviceList, gMicQueue, gDevicesChanged);
			syncDeviceListeners();
		} else if (!on && gMicOn) {
			gMicOn = NO;
			AudioObjectRemovePropertyListenerBlock(kAudioObjectSystemObject, &kProcessList, gMicQueue, gMicChanged);
			AudioObjectRemovePropertyListenerBlock(kAudioObjectSystemObject, &kDeviceList, gMicQueue, gDevicesChanged);
			for (NSNumber *dev in gWatchedDevices)
				AudioObjectRemovePropertyListenerBlock(dev.unsignedIntValue, &kDeviceRunning, gMicQueue, gMicChanged);
			gWatchedDevices = nil;
		}
	});
	return 1;
}
