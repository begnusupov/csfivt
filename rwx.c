#include <stdio.h>
#include <string.h>
#include <stdlib.h>

int main() {
	int n, i;
	scanf("%d", &n);
	int a[3] = {n / 100, n % 100 / 10, n % 10};
	for(i = 0; i < 3; i++) {
		if(a[i] == 1) {
			printf("--x");
		}
		else if(a[i] == 2) {
			printf("-w-");
		}
		else if(a[i] == 3) {
			printf("-wx");
		}
		else if(a[i] == 4) {
			printf("r--");
		}
		else if(a[i] == 5) {
			printf("r-x");
		}
		else if(a[i] == 6) {
			printf("rw-");
		}
		else if(a[i] == 7) {
			printf("rwx");
		}
		else if(a[i] == 0) {
			printf("---");
		}
	}
	return 0;
}
