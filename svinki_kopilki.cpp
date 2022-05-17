#include <iostream>
#include <vector>

using namespace std;

void print_vector(vector<int> &vec) {
    for (int i: vec)
        cout << i << " ";
    cout << "\n";
}

int main() {
    int num_of_money_boxes, number, number_of_cycles = 0, color = 1, ver;
    cin >> num_of_money_boxes;

    vector<int> key_loc_list;
    for (int i = 0; i < num_of_money_boxes; i++) {
        cin >> number;
        key_loc_list.emplace_back(number);
    }
    // print_vector(key_loc_list);

    vector<int> ver_colors(num_of_money_boxes, 0);
    for (int i = 0; i < num_of_money_boxes; i++) {
        ver = i;
        if (ver_colors[ver] != 0)
            continue;

        while(true) {
            ver_colors[ver] = color; 
            ver = key_loc_list[ver];

            if (ver_colors[ver] == color) {
                number_of_cycles++;
                color++;
                break;
            }
            if (ver_colors[ver] != 0)
                break;
        }
    }
    
    cout << number_of_cycles << "\n";

    return EXIT_SUCCESS;
}
