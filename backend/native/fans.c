// Reads fan speeds from the AppleSMC IOKit user client. No elevated privileges are required.
// Output: "fans\t<count>" followed by one "fan<N>\t<actual>\t<min>\t<max>" line per fan (RPM).
#include <IOKit/IOKitLib.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>

typedef struct { char major, minor, build, reserved; uint16_t release; } SMCVersion;
typedef struct { uint16_t version, length; uint32_t cpuPLimit, gpuPLimit, memPLimit; } SMCPLimit;
typedef struct { uint32_t dataSize, dataType; uint8_t dataAttributes; } SMCKeyInfo;
typedef struct {
  uint32_t key;
  SMCVersion vers;
  SMCPLimit pLimitData;
  SMCKeyInfo keyInfo;
  uint8_t result, status, data8;
  uint32_t data32;
  uint8_t bytes[32];
} SMCKeyData;

enum { kSMCUserClient = 2, kSMCReadBytes = 5, kSMCGetKeyInfo = 9 };

static uint32_t fourcc(const char *s) {
  return ((uint32_t)s[0] << 24) | ((uint32_t)s[1] << 16) | ((uint32_t)s[2] << 8) | (uint32_t)s[3];
}

static int call(io_connect_t conn, SMCKeyData *in, SMCKeyData *out) {
  size_t outSize = sizeof(SMCKeyData);
  return IOConnectCallStructMethod(conn, kSMCUserClient, in, sizeof(SMCKeyData), out, &outSize) == KERN_SUCCESS && out->result == 0;
}

// Returns the decoded numeric value of a key, or -1 when it cannot be read.
static double readKey(io_connect_t conn, const char *key) {
  SMCKeyData in, out;
  memset(&in, 0, sizeof in);
  memset(&out, 0, sizeof out);
  in.key = fourcc(key);
  in.data8 = kSMCGetKeyInfo;
  if (!call(conn, &in, &out)) return -1;
  SMCKeyInfo info = out.keyInfo;
  memset(&in, 0, sizeof in);
  in.key = fourcc(key);
  in.keyInfo.dataSize = info.dataSize;
  in.data8 = kSMCReadBytes;
  memset(&out, 0, sizeof out);
  if (!call(conn, &in, &out)) return -1;
  uint32_t type = info.dataType;
  if (type == fourcc("flt ") && info.dataSize == 4) {
    float f;
    memcpy(&f, out.bytes, 4);
    return f;
  }
  if (type == fourcc("ui8 ")) return out.bytes[0];
  if (type == fourcc("ui16") && info.dataSize == 2) return (out.bytes[0] << 8) | out.bytes[1];
  if (type == fourcc("fpe2") && info.dataSize == 2) return ((out.bytes[0] << 8) | out.bytes[1]) / 4.0;
  return -1;
}

int main(void) {
  io_service_t service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"));
  if (!service) return 1;
  io_connect_t conn;
  kern_return_t result = IOServiceOpen(service, mach_task_self(), 0, &conn);
  IOObjectRelease(service);
  if (result != KERN_SUCCESS) return 1;
  double count = readKey(conn, "FNum");
  if (count < 0) return 1;
  printf("fans\t%d\n", (int)count);
  for (int i = 0; i < (int)count && i < 8; i++) {
    char key[5];
    snprintf(key, sizeof key, "F%dAc", i);
    double actual = readKey(conn, key);
    snprintf(key, sizeof key, "F%dMn", i);
    double min = readKey(conn, key);
    snprintf(key, sizeof key, "F%dMx", i);
    double max = readKey(conn, key);
    printf("fan%d\t%.0f\t%.0f\t%.0f\n", i, actual, min, max);
  }
  IOServiceClose(conn);
  return 0;
}
