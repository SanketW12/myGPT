#import <Cocoa/Cocoa.h>
#import <IOKit/hid/IOHIDManager.h>
#import <sys/time.h>

static uint64_t lastTriggerMs = 0;

static uint64_t current_time_ms(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint64_t)(tv.tv_sec) * 1000 + (uint64_t)(tv.tv_usec) / 1000;
}

static void triggerFn(void) {
    uint64_t now = current_time_ms();
    // Debounce triggers within 300ms to avoid duplicate event signals
    if (now - lastTriggerMs < 300) {
        return;
    }
    lastTriggerMs = now;
    printf("FN_PRESS\n");
    fflush(stdout);
}

// IOHIDManager callback for hardware HID event reports
static void hidCallback(void* context, IOReturn result, void* sender, IOHIDValueRef value) {
    IOHIDElementRef elem = IOHIDValueGetElement(value);
    uint32_t usagePage = IOHIDElementGetUsagePage(elem);
    uint32_t usage = IOHIDElementGetUsage(elem);
    CFIndex intValue = IOHIDValueGetIntegerValue(value);

    // Apple Vendor Top Case page (0xff, 0xff00, 0xff01, 0xff03) with usage 0x03 (Fn key)
    if ((usagePage == 0xff || usagePage == 0xff00 || usagePage == 0xff01 || usagePage == 0xff03) && usage == 0x03) {
        if (intValue == 1) {
            triggerFn();
        }
    }
}

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        [NSApplication sharedApplication];

        // 1. IOHIDManager setup (catches hardware Fn key on Apple keyboards)
        IOHIDManagerRef hidManager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
        if (hidManager) {
            IOHIDManagerSetDeviceMatching(hidManager, NULL);
            IOHIDManagerRegisterInputValueCallback(hidManager, hidCallback, NULL);
            IOHIDManagerScheduleWithRunLoop(hidManager, CFRunLoopGetMain(), kCFRunLoopDefaultMode);
            IOHIDManagerOpen(hidManager, kIOHIDOptionsTypeNone);
        }

        // 2. NSEvent monitor setup (catches Cocoa flagsChanged modifier flag transitions)
        __block BOOL lastFnState = NO;
        [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged handler:^(NSEvent *event) {
            BOOL isFnActive = (event.modifierFlags & NSEventModifierFlagFunction) != 0;
            if (event.keyCode == 63) { // 63 is the standard Apple keyboard Fn keycode
                if (isFnActive && !lastFnState) {
                    triggerFn();
                }
                lastFnState = isFnActive;
            } else if (isFnActive != lastFnState) {
                if (isFnActive) {
                    triggerFn();
                }
                lastFnState = isFnActive;
            }
        }];

        // Also add local monitor for when the window is focused
        [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged handler:^NSEvent *(NSEvent *event) {
            BOOL isFnActive = (event.modifierFlags & NSEventModifierFlagFunction) != 0;
            if (event.keyCode == 63) {
                if (isFnActive && !lastFnState) {
                    triggerFn();
                }
                lastFnState = isFnActive;
            } else if (isFnActive != lastFnState) {
                if (isFnActive) {
                    triggerFn();
                }
                lastFnState = isFnActive;
            }
            return event;
        }];

        printf("FN_LISTENER_READY\n");
        fflush(stdout);

        CFRunLoopRun();
    }
    return 0;
}

