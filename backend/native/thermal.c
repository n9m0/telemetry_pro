// Reads Apple Silicon temperature sensors through the IOHID event system.
// No elevated privileges are required. Output: one "<sensor name>\t<celsius>" line per sensor.
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;

extern IOHIDEventSystemClientRef IOHIDEventSystemClientCreate(CFAllocatorRef);
extern int IOHIDEventSystemClientSetMatching(IOHIDEventSystemClientRef, CFDictionaryRef);
extern CFArrayRef IOHIDEventSystemClientCopyServices(IOHIDEventSystemClientRef);
extern IOHIDEventRef IOHIDServiceClientCopyEvent(IOHIDServiceClientRef, int64_t, int32_t, int64_t);
extern CFTypeRef IOHIDServiceClientCopyProperty(IOHIDServiceClientRef, CFStringRef);
extern double IOHIDEventGetFloatValue(IOHIDEventRef, int32_t);

#define kIOHIDEventTypeTemperature 15

int main(void) {
  int page = 0xff00, usage = 5;
  CFNumberRef pageRef = CFNumberCreate(NULL, kCFNumberIntType, &page);
  CFNumberRef usageRef = CFNumberCreate(NULL, kCFNumberIntType, &usage);
  const void *keys[] = { CFSTR("PrimaryUsagePage"), CFSTR("PrimaryUsage") };
  const void *values[] = { pageRef, usageRef };
  CFDictionaryRef matching = CFDictionaryCreate(NULL, keys, values, 2, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  IOHIDEventSystemClientRef client = IOHIDEventSystemClientCreate(NULL);
  if (!client) return 1;
  IOHIDEventSystemClientSetMatching(client, matching);
  CFArrayRef services = IOHIDEventSystemClientCopyServices(client);
  if (!services) return 1;
  for (CFIndex i = 0; i < CFArrayGetCount(services); i++) {
    IOHIDServiceClientRef service = (IOHIDServiceClientRef)CFArrayGetValueAtIndex(services, i);
    IOHIDEventRef event = IOHIDServiceClientCopyEvent(service, kIOHIDEventTypeTemperature, 0, 0);
    if (!event) continue;
    char name[128] = "unknown";
    CFStringRef product = (CFStringRef)IOHIDServiceClientCopyProperty(service, CFSTR("Product"));
    if (product) CFStringGetCString(product, name, sizeof name, kCFStringEncodingUTF8);
    printf("%s\t%.2f\n", name, IOHIDEventGetFloatValue(event, kIOHIDEventTypeTemperature << 16));
  }
  return 0;
}
